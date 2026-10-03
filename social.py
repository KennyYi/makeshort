"""Local OAuth, credential storage, and short-form publishing integrations."""

from __future__ import annotations

import base64
import hashlib
import http.client
import json
import logging
import math
import os
import secrets
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


GRAPH_VERSION = "v26.0"
GRAPH_ROOT = f"https://graph.facebook.com/{GRAPH_VERSION}"
YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload"
TIKTOK_SCOPES = "user.info.basic,video.publish"
SOCIAL_MAX_UPLOAD_BYTES = 1_000_000_000
GOOGLE_CHUNK_BYTES = 8 * 1024 * 1024
TIKTOK_CHUNK_BYTES = 10 * 1024 * 1024
KEYRING_SERVICE = "makeshort.social"
logger = logging.getLogger("makeshort.social")

PROVIDERS = {
    "youtube": {"label": "YouTube Shorts", "client_field": "client_id"},
    "instagram": {"label": "Instagram Reels", "client_field": "app_id"},
    "tiktok": {"label": "TikTok", "client_field": "client_key"},
}


class SocialError(Exception):
    """An expected integration, account, or remote API error."""


def _read_json_response(body: bytes) -> dict[str, Any]:
    try:
        value = json.loads(body.decode("utf-8")) if body else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _remote_error_message(payload: dict[str, Any], fallback: str) -> str:
    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("error_description")
    else:
        message = error or payload.get("message")
    if isinstance(message, str) and message.strip():
        return message.strip()[:600]
    return fallback


def request_raw(
    url: str,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 120,
) -> tuple[int, dict[str, str], bytes]:
    request = Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read(2 * 1024 * 1024)
    except HTTPError as exc:
        body = exc.read(256 * 1024)
        payload = _read_json_response(body)
        message = _remote_error_message(payload, f"Remote API returned HTTP {exc.code}.")
        raise SocialError(message) from None
    except URLError as exc:
        reason = getattr(exc, "reason", None)
        raise SocialError(f"서비스에 연결하지 못했습니다: {reason or '네트워크 오류'}") from None
    except TimeoutError:
        raise SocialError("플랫폼 응답 시간이 초과되었습니다.") from None


def request_json(
    url: str,
    method: str = "GET",
    form: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 120,
) -> dict[str, Any]:
    request_headers = dict(headers or {})
    body = None
    if form is not None:
        body = urlencode({key: value for key, value in form.items() if value is not None}).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    elif payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json; charset=UTF-8")
    status, response_headers, response_body = request_raw(
        url, method=method, data=body, headers=request_headers, timeout=timeout,
    )
    result = _read_json_response(response_body)
    if status < 200 or status >= 300:
        raise SocialError(_remote_error_message(result, f"Remote API returned HTTP {status}."))
    error = result.get("error")
    if error and not (isinstance(error, dict) and error.get("code") == "ok"):
        raise SocialError(_remote_error_message(result, "The platform rejected the request."))
    return result


def stream_file_request(
    url: str,
    method: str,
    headers: dict[str, str],
    file_path: Path,
    offset: int = 0,
    length: int | None = None,
    timeout: int = 900,
) -> tuple[int, dict[str, str], bytes]:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise SocialError("플랫폼에서 안전하지 않은 업로드 주소를 반환했습니다.")
    total = file_path.stat().st_size
    if length is None:
        length = total - offset
    if offset < 0 or length < 0 or offset + length > total:
        raise SocialError("업로드 파일 범위를 확인해 주세요.")

    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=timeout)
    target = parsed.path or "/"
    if parsed.query:
        target += f"?{parsed.query}"
    request_headers = {**headers, "Content-Length": str(length), "Connection": "close"}
    try:
        connection.putrequest(method, target)
        for name, value in request_headers.items():
            connection.putheader(name, value)
        connection.endheaders()
        with file_path.open("rb") as source:
            source.seek(offset)
            remaining = length
            while remaining:
                chunk = source.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise SocialError("영상 파일을 읽는 도중 업로드가 중단됐습니다.")
                connection.send(chunk)
                remaining -= len(chunk)
        response = connection.getresponse()
        body = response.read(2 * 1024 * 1024)
        return response.status, {key.lower(): value for key, value in response.getheaders()}, body
    except (OSError, http.client.HTTPException, TimeoutError) as exc:
        raise SocialError(f"영상 업로드 중 연결 오류가 발생했습니다: {exc}") from None
    finally:
        connection.close()


class SocialManager:
    def __init__(self) -> None:
        self.data_dir = Path.home() / ".makeshort"
        self.config_path = self.data_dir / "social.json"
        self.accounts_path = self.data_dir / "accounts.json"
        self.redirect_base = "http://127.0.0.1:8000/oauth"
        self.pending: dict[str, dict[str, Any]] = {}
        self.pending_lock = threading.Lock()
        self.file_lock = threading.RLock()

    def _read_store(self, path: Path) -> dict[str, Any]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError):
            raise SocialError(f"로컬 계정 파일을 읽지 못했습니다: {path}") from None
        return value if isinstance(value, dict) else {}

    def _write_store(self, path: Path, data: dict[str, Any]) -> None:
        self.data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            os.chmod(self.data_dir, 0o700)
        except OSError:
            pass
        descriptor, temporary_name = tempfile.mkstemp(prefix=f"{path.name}.", dir=self.data_dir)
        temporary = Path(temporary_name)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
                json.dump(data, destination, ensure_ascii=False, indent=2)
                destination.write("\n")
            os.replace(temporary, path)
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _keyring(self):
        try:
            import keyring
        except ImportError:
            raise SocialError("계정 암호 보관 기능이 없습니다. requirements.txt의 패키지를 설치해 주세요.") from None
        try:
            backend = keyring.get_keyring()
            backend_name = type(backend).__name__.lower()
            if backend.priority <= 0 or any(word in backend_name for word in ("plaintext", "fail", "null")):
                raise SocialError("시스템 키체인을 사용할 수 없습니다. macOS 키체인을 확인해 주세요.")
        except SocialError:
            raise
        except Exception as exc:
            raise SocialError(f"시스템 키체인을 열지 못했습니다: {exc}") from None
        return keyring

    def _get_secret(self, key: str) -> str | None:
        try:
            return self._keyring().get_password(KEYRING_SERVICE, key)
        except SocialError:
            raise
        except Exception as exc:
            raise SocialError(f"시스템 키체인에서 계정 정보를 읽지 못했습니다: {exc}") from None

    def _set_secret(self, key: str, value: str) -> None:
        try:
            self._keyring().set_password(KEYRING_SERVICE, key, value)
        except SocialError:
            raise
        except Exception as exc:
            raise SocialError(f"시스템 키체인에 계정 정보를 저장하지 못했습니다: {exc}") from None

    def _delete_secret(self, key: str) -> None:
        try:
            self._keyring().delete_password(KEYRING_SERVICE, key)
        except Exception:
            pass

    def _credentials(self, provider: str) -> tuple[str, str]:
        config = self._read_store(self.config_path).get(provider, {})
        client_id = config.get("client_id") if isinstance(config, dict) else None
        secret = self._get_secret(f"client-secret:{provider}")
        if not isinstance(client_id, str) or not client_id or not secret:
            raise SocialError(f"{PROVIDERS[provider]['label']} 앱 키를 먼저 저장해 주세요.")
        return client_id, secret

    def configure(self, provider: str, client_id: object, client_secret: object) -> dict[str, Any]:
        if not isinstance(provider, str) or provider not in PROVIDERS:
            raise SocialError("지원하지 않는 플랫폼입니다.")
        if not isinstance(client_id, str) or not client_id.strip() or len(client_id) > 500:
            raise SocialError("플랫폼 앱 ID 또는 Client Key를 입력해 주세요.")
        if not isinstance(client_secret, str) or not client_secret.strip() or len(client_secret) > 2000:
            raise SocialError("플랫폼 앱 Secret을 입력해 주세요.")
        with self.file_lock:
            config = self._read_store(self.config_path)
            config[provider] = {"client_id": client_id.strip()}
            self._set_secret(f"client-secret:{provider}", client_secret.strip())
            self._write_store(self.config_path, config)
        return self.status()

    def status(self) -> dict[str, Any]:
        config = self._read_store(self.config_path)
        accounts = self._read_store(self.accounts_path)
        try:
            keyring_available = self._keyring() is not None
        except SocialError:
            keyring_available = False
        providers: dict[str, Any] = {}
        for provider, definition in PROVIDERS.items():
            item_config = config.get(provider, {})
            item_account = accounts.get(provider, {})
            try:
                has_secret = bool(self._get_secret(f"client-secret:{provider}")) if keyring_available else False
            except SocialError:
                has_secret = False
            try:
                has_token = bool(self._get_secret(f"tokens:{provider}")) if keyring_available else False
            except SocialError:
                has_token = False
            provider_accounts = item_account.get("accounts", []) if isinstance(item_account, dict) else []
            providers[provider] = {
                "label": definition["label"],
                "configured": bool(isinstance(item_config, dict) and item_config.get("client_id") and has_secret),
                "connected": has_token and bool(provider_accounts),
                "account_name": item_account.get("account_name", "") if isinstance(item_account, dict) else "",
                "account_id": item_account.get("account_id", "") if isinstance(item_account, dict) else "",
                "accounts": [
                    {"id": account.get("id", ""), "name": account.get("name", "")}
                    for account in provider_accounts if isinstance(account, dict)
                ],
                "selected_id": item_account.get("selected_id", "") if isinstance(item_account, dict) else "",
            }
        return {
            "keyring_available": keyring_available,
            "data_location": str(self.data_dir),
            "providers": providers,
        }

    def disconnect(self, provider: str) -> dict[str, Any]:
        if not isinstance(provider, str) or provider not in PROVIDERS:
            raise SocialError("지원하지 않는 플랫폼입니다.")
        self._delete_secret(f"tokens:{provider}")
        with self.file_lock:
            accounts = self._read_store(self.accounts_path)
            accounts.pop(provider, None)
            self._write_store(self.accounts_path, accounts)
        return self.status()

    def select_account(self, provider: str, account_id: object) -> dict[str, Any]:
        if provider != "instagram" or not isinstance(account_id, str):
            raise SocialError("선택할 Instagram 계정을 확인해 주세요.")
        with self.file_lock:
            accounts = self._read_store(self.accounts_path)
            item = accounts.get("instagram", {})
            available = item.get("accounts", []) if isinstance(item, dict) else []
            selected = next((row for row in available if row.get("id") == account_id), None)
            if not selected:
                raise SocialError("연결된 Instagram 계정 목록에서 선택해 주세요.")
            item["selected_id"] = account_id
            item["account_id"] = account_id
            item["account_name"] = selected.get("name", "Instagram")
            accounts["instagram"] = item
            self._write_store(self.accounts_path, accounts)
        return self.status()

    def oauth_start(self, provider: str) -> str:
        if not isinstance(provider, str) or provider not in PROVIDERS:
            raise SocialError("지원하지 않는 플랫폼입니다.")
        client_id, _secret = self._credentials(provider)
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(48)
        redirect_uri = f"{self.redirect_base}/{provider}/callback"
        pending: dict[str, Any] = {
            "provider": provider,
            "created_at": time.time(),
            "verifier": verifier,
            "redirect_uri": redirect_uri,
        }
        if provider == "youtube":
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            query = {
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": YOUTUBE_SCOPE,
                "access_type": "offline",
                "prompt": "consent",
                "include_granted_scopes": "true",
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
            url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(query)
        elif provider == "instagram":
            query = {
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": "pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish",
                "state": state,
            }
            url = "https://www.facebook.com/v26.0/dialog/oauth?" + urlencode(query)
        else:
            challenge = hashlib.sha256(verifier.encode()).hexdigest()
            query = {
                "client_key": client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": TIKTOK_SCOPES,
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
            url = "https://www.tiktok.com/v2/auth/authorize/?" + urlencode(query)
        with self.pending_lock:
            now = time.time()
            self.pending = {key: value for key, value in self.pending.items() if now - value["created_at"] < 900}
            self.pending[state] = pending
        return url

    def oauth_callback(self, provider: str, query: dict[str, list[str]]) -> str:
        state = (query.get("state") or [""])[0]
        code = (query.get("code") or [""])[0]
        remote_error = (query.get("error_description") or query.get("error") or [""])[0]
        with self.pending_lock:
            pending = self.pending.pop(state, None)
        if not pending or pending.get("provider") != provider or time.time() - pending.get("created_at", 0) > 900:
            raise SocialError("인증 요청이 만료되었거나 state가 일치하지 않습니다. 앱에서 다시 연결해 주세요.")
        if remote_error:
            raise SocialError(f"계정 인증이 취소되었거나 거절되었습니다: {remote_error[:300]}")
        if not code:
            raise SocialError("플랫폼에서 인증 코드를 받지 못했습니다.")
        client_id, client_secret = self._credentials(provider)
        if provider == "youtube":
            token = request_json(
                "https://oauth2.googleapis.com/token", method="POST",
                form={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "code_verifier": pending["verifier"],
                    "grant_type": "authorization_code",
                    "redirect_uri": pending["redirect_uri"],
                },
            )
            old = self._load_tokens("youtube") or {}
            if not token.get("refresh_token"):
                token["refresh_token"] = old.get("refresh_token")
            if not token.get("refresh_token"):
                raise SocialError("Google에서 refresh token을 반환하지 않았습니다. 연결을 해제하고 다시 승인해 주세요.")
            token["expires_at"] = time.time() + int(token.get("expires_in", 3600))
            channel_id = "youtube"
            channel_name = "YouTube 채널"
            try:
                channel = request_json(
                    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
                    headers={"Authorization": f"Bearer {token['access_token']}"},
                )
                items = channel.get("items", [])
                if items:
                    channel_id = str(items[0].get("id") or channel_id)
                    channel_name = items[0].get("snippet", {}).get("title") or channel_name
            except SocialError:
                pass
            self._save_provider("youtube", token, [{"id": channel_id, "name": channel_name}], channel_id, channel_name)
        elif provider == "instagram":
            short = request_json(
                "https://graph.facebook.com/v26.0/oauth/access_token", method="POST",
                form={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": pending["redirect_uri"],
                    "code": code,
                },
            )
            user_token = short.get("access_token")
            if not user_token:
                raise SocialError("Meta에서 사용자 액세스 토큰을 받지 못했습니다.")
            long_token = request_json(
                f"{GRAPH_ROOT}/oauth/access_token?" + urlencode({
                    "grant_type": "fb_exchange_token",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "fb_exchange_token": user_token,
                }),
            )
            access_token = long_token.get("access_token") or user_token
            page_result = request_json(
                f"{GRAPH_ROOT}/me/accounts?" + urlencode({
                    "fields": "id,name,access_token,instagram_business_account{id,username}",
                    "access_token": access_token,
                    "limit": "100",
                }),
            )
            pages = page_result.get("data", [])
            available = []
            page_tokens = {}
            for page in pages:
                ig = page.get("instagram_business_account") if isinstance(page, dict) else None
                if not isinstance(ig, dict) or not ig.get("id") or not page.get("access_token"):
                    continue
                ig_id = str(ig["id"])
                name = ig.get("username") or page.get("name") or "Instagram 계정"
                available.append({"id": ig_id, "name": f"@{name}", "page_id": str(page.get("id", ""))})
                page_tokens[ig_id] = {
                    "access_token": page["access_token"],
                    "page_id": str(page.get("id", "")),
                }
            if not available:
                raise SocialError("연결 가능한 Instagram 프로 계정을 찾지 못했습니다. Instagram Business/Creator 계정이 Facebook Page에 연결되어 있고, 요청한 Meta 권한이 승인되었는지 확인해 주세요.")
            chosen = available[0]
            token_bundle = {
                "user_access_token": access_token,
                "pages": page_tokens,
            }
            self._save_provider("instagram", token_bundle, available, chosen["id"], chosen["name"])
        else:
            token = request_json(
                "https://open.tiktokapis.com/v2/oauth/token/", method="POST",
                form={
                    "client_key": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": pending["redirect_uri"],
                    "code_verifier": pending["verifier"],
                },
            )
            data = token.get("data", token)
            if not isinstance(data, dict) or not data.get("access_token"):
                raise SocialError(_remote_error_message(token, "TikTok에서 액세스 토큰을 받지 못했습니다."))
            token = dict(data)
            token["expires_at"] = time.time() + int(token.get("expires_in", 86400))
            name = "TikTok 계정"
            try:
                user = request_json(
                    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
                    headers={"Authorization": f"Bearer {token['access_token']}"},
                )
                user_data = user.get("data", {}).get("user", {})
                name = user_data.get("display_name") or name
                token["open_id"] = user_data.get("open_id") or token.get("open_id")
            except (SocialError, AttributeError):
                pass
            account_id = str(token.get("open_id") or "tiktok")
            self._save_provider("tiktok", token, [{"id": account_id, "name": name}], account_id, name)
        return "연결되었습니다. 이 창을 닫고 MakeShort로 돌아가세요."

    def _save_provider(
        self,
        provider: str,
        token_bundle: dict[str, Any],
        available: list[dict[str, str]],
        selected_id: str,
        account_name: str,
    ) -> None:
        self._set_secret(f"tokens:{provider}", json.dumps(token_bundle, ensure_ascii=False))
        with self.file_lock:
            accounts = self._read_store(self.accounts_path)
            accounts[provider] = {
                "account_id": selected_id,
                "account_name": account_name,
                "selected_id": selected_id,
                "accounts": available,
                "updated_at": int(time.time()),
            }
            self._write_store(self.accounts_path, accounts)

    def _load_tokens(self, provider: str) -> dict[str, Any] | None:
        raw = self._get_secret(f"tokens:{provider}")
        if not raw:
            return None
        try:
            token = json.loads(raw)
        except json.JSONDecodeError:
            raise SocialError("로컬 토큰 정보를 읽지 못했습니다. 플랫폼 계정을 다시 연결해 주세요.") from None
        return token if isinstance(token, dict) else None

    def _store_tokens(self, provider: str, tokens: dict[str, Any]) -> None:
        self._set_secret(f"tokens:{provider}", json.dumps(tokens, ensure_ascii=False))

    def _refresh_access_token(self, provider: str, tokens: dict[str, Any]) -> dict[str, Any]:
        client_id, client_secret = self._credentials(provider)
        if provider == "youtube":
            refreshed = request_json(
                "https://oauth2.googleapis.com/token", method="POST",
                form={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": tokens.get("refresh_token"),
                    "grant_type": "refresh_token",
                },
            )
        elif provider == "tiktok":
            refreshed = request_json(
                "https://open.tiktokapis.com/v2/oauth/token/", method="POST",
                form={
                    "client_key": client_id,
                    "client_secret": client_secret,
                    "grant_type": "refresh_token",
                    "refresh_token": tokens.get("refresh_token"),
                },
            )
            refreshed = refreshed.get("data", refreshed)
        elif provider == "instagram":
            raise SocialError("Meta Page 토큰을 자동 갱신할 수 없습니다. 계정 권한이 만료되면 다시 연결해 주세요.")
        else:
            raise SocialError("이 플랫폼의 토큰 갱신을 지원하지 않습니다.")
        if not isinstance(refreshed, dict) or not refreshed.get("access_token"):
            raise SocialError("플랫폼 토큰을 갱신하지 못했습니다. 계정을 다시 연결해 주세요.")
        keep = {key: value for key, value in tokens.items() if key not in {"access_token", "expires_in", "expires_at"}}
        keep.update(refreshed)
        keep["expires_at"] = time.time() + int(refreshed.get("expires_in", 86400))
        self._store_tokens(provider, keep)
        return keep

    def _access_tokens(self, provider: str) -> dict[str, Any]:
        tokens = self._load_tokens(provider)
        if not tokens:
            raise SocialError(f"{PROVIDERS[provider]['label']} 계정을 먼저 연결해 주세요.")
        expiry = float(tokens.get("expires_at", 0) or 0)
        if expiry and expiry - time.time() < 300:
            tokens = self._refresh_access_token(provider, tokens)
        return tokens

    def instagram_creator_info(self) -> dict[str, Any]:
        self._access_tokens("instagram")
        return {"available": True}

    def tiktok_creator_info(self) -> dict[str, Any]:
        tokens = self._access_tokens("tiktok")
        response = request_json(
            "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
            method="POST",
            payload={},
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        return response.get("data", {})

    def publish(self, file_path: Path, request: object) -> dict[str, Any]:
        if not isinstance(request, dict):
            raise SocialError("배포 요청 JSON을 확인해 주세요.")
        targets = request.get("targets")
        if not isinstance(targets, list) or not targets or any(not isinstance(target, str) or target not in PROVIDERS for target in targets):
            raise SocialError("배포할 플랫폼을 하나 이상 선택해 주세요.")
        targets = list(dict.fromkeys(targets))
        metadata = request.get("metadata", {})
        if not isinstance(metadata, dict):
            raise SocialError("게시물 설정을 확인해 주세요.")
        if file_path.stat().st_size > SOCIAL_MAX_UPLOAD_BYTES:
            raise SocialError("배포 파일은 플랫폼 공통 제한인 1GB 이하여야 합니다.")
        info = self._inspect_video(file_path)
        results = []
        for provider in targets:
            try:
                if provider == "youtube":
                    result = self._publish_youtube(file_path, metadata, info)
                elif provider == "instagram":
                    result = self._publish_instagram(file_path, metadata, info)
                else:
                    result = self._publish_tiktok(file_path, metadata, info)
                results.append({"provider": provider, "ok": True, **result})
            except SocialError as exc:
                results.append({"provider": provider, "ok": False, "error": str(exc)})
            except Exception:
                logger.exception("Unexpected error publishing to %s", provider)
                results.append({"provider": provider, "ok": False, "error": "게시 중 예상하지 못한 오류가 발생했습니다. 앱 로그를 확인해 주세요."})
        return {"results": results}

    def _inspect_video(self, file_path: Path) -> dict[str, float | int]:
        try:
            result = subprocess.run(
                [
                    "ffprobe", "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=width,height:format=duration",
                    "-of", "json", str(file_path),
                ], capture_output=True, text=True, check=True, timeout=60,
            )
            payload = json.loads(result.stdout)
            stream = payload.get("streams", [])[0]
            duration = float(payload.get("format", {}).get("duration", 0))
            width, height = int(stream.get("width", 0)), int(stream.get("height", 0))
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError, IndexError, TypeError, ValueError):
            raise SocialError("배포할 MP4 영상 정보를 읽지 못했습니다.") from None
        if width < 1 or height < 1 or duration <= 0:
            raise SocialError("배포할 영상의 해상도와 길이를 확인해 주세요.")
        return {"width": width, "height": height, "duration": duration}

    def _publish_youtube(self, file_path: Path, metadata: dict[str, Any], info: dict[str, Any]) -> dict[str, Any]:
        if info["duration"] > 180 or info["height"] < info["width"]:
            raise SocialError("YouTube Shorts는 세로 또는 정사각형 영상이며 3분 이하여야 합니다.")
        title = metadata.get("youtube_title") or metadata.get("title") or file_path.stem
        description = metadata.get("youtube_description", "")
        privacy = metadata.get("youtube_privacy", "private")
        if not isinstance(title, str) or not title.strip() or len(title) > 100:
            raise SocialError("YouTube 제목은 1~100자여야 합니다.")
        if not isinstance(description, str) or len(description) > 5000:
            raise SocialError("YouTube 설명은 5,000자 이하여야 합니다.")
        if privacy not in {"private", "unlisted", "public"}:
            raise SocialError("YouTube 공개 범위를 확인해 주세요.")
        tokens = self._access_tokens("youtube")
        size = file_path.stat().st_size
        video = {
            "snippet": {
                "title": title.strip(),
                "description": description,
                "categoryId": "22",
            },
            "status": {
                "privacyStatus": privacy,
                "selfDeclaredMadeForKids": False,
            },
        }
        status, response_headers, _body = request_raw(
            "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
            method="POST",
            data=json.dumps(video, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {tokens['access_token']}",
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": "video/mp4",
                "X-Upload-Content-Length": str(size),
            },
        )
        upload_url = next((value for name, value in response_headers.items() if name.lower() == "location"), "")
        if status not in {200, 201} or not upload_url:
            raise SocialError("YouTube 업로드 세션을 만들지 못했습니다.")
        offset = 0
        resource: dict[str, Any] = {}
        while offset < size:
            length = min(GOOGLE_CHUNK_BYTES, size - offset)
            end = offset + length - 1
            upload_status, upload_headers, response_body = stream_file_request(
                upload_url,
                "PUT",
                {
                    "Authorization": f"Bearer {tokens['access_token']}",
                    "Content-Type": "video/mp4",
                    "Content-Range": f"bytes {offset}-{end}/{size}",
                },
                file_path,
                offset=offset,
                length=length,
            )
            if upload_status in {200, 201}:
                resource = _read_json_response(response_body)
                break
            if upload_status != 308:
                raise SocialError(_remote_error_message(_read_json_response(response_body), f"YouTube returned HTTP {upload_status} during upload."))
            received = upload_headers.get("range", "")
            if received.startswith("bytes=0-"):
                offset = int(received.rsplit("-", 1)[1]) + 1
            else:
                offset = end + 1
        video_id = resource.get("id")
        if not video_id:
            raise SocialError("YouTube가 게시물 ID를 반환하지 않았습니다.")
        return {"account": "YouTube", "id": video_id, "url": f"https://www.youtube.com/watch?v={video_id}"}

    def _publish_instagram(self, file_path: Path, metadata: dict[str, Any], info: dict[str, Any]) -> dict[str, Any]:
        if info["duration"] < 3 or info["duration"] > 900:
            raise SocialError("Instagram Reels 영상 길이는 3초~15분이어야 합니다.")
        tokens = self._access_tokens("instagram")
        account_store = self._read_store(self.accounts_path).get("instagram", {})
        ig_id = account_store.get("selected_id") or account_store.get("account_id")
        page = tokens.get("pages", {}).get(str(ig_id), {})
        page_token = page.get("access_token")
        if not ig_id or not page_token:
            raise SocialError("Instagram 계정을 다시 연결하거나 게시할 계정을 선택해 주세요.")
        caption = metadata.get("instagram_caption", metadata.get("caption", ""))
        if not isinstance(caption, str) or len(caption) > 2200:
            raise SocialError("Instagram 캡션은 2,200자 이하여야 합니다.")
        share_to_feed = metadata.get("instagram_share_to_feed", True)
        if not isinstance(share_to_feed, bool):
            raise SocialError("Instagram 피드 공유 설정을 확인해 주세요.")
        container = request_json(
            f"{GRAPH_ROOT}/{ig_id}/media", method="POST",
            form={
                "media_type": "REELS",
                "upload_type": "resumable",
                "caption": caption,
                "share_to_feed": str(share_to_feed).lower(),
            },
            headers={"Authorization": f"Bearer {page_token}"},
        )
        container_id = container.get("id")
        if not container_id:
            raise SocialError("Instagram에서 미디어 컨테이너를 받지 못했습니다.")
        upload_uri = container.get("uri") or f"https://rupload.facebook.com/ig-api-upload/{GRAPH_VERSION}/{container_id}"
        if urlsplit(upload_uri).hostname != "rupload.facebook.com":
            raise SocialError("Instagram에서 안전하지 않은 업로드 주소를 반환했습니다.")
        size = file_path.stat().st_size
        upload_status, _headers, upload_body = stream_file_request(
            upload_uri,
            "POST",
            {
                "Authorization": f"OAuth {page_token}",
                "offset": "0",
                "file_size": str(size),
                "Content-Type": "application/octet-stream",
            },
            file_path,
        )
        upload_result = _read_json_response(upload_body)
        if upload_status < 200 or upload_status >= 300 or upload_result.get("success") is False:
            raise SocialError(_remote_error_message(upload_result, "Instagram Reel 업로드에 실패했습니다."))

        state = "IN_PROGRESS"
        status_payload: dict[str, Any] = {}
        for _ in range(90):
            time.sleep(2)
            status_payload = request_json(
                f"{GRAPH_ROOT}/{container_id}?" + urlencode({"fields": "status_code,status"}),
                headers={"Authorization": f"Bearer {page_token}"},
            )
            state = str(status_payload.get("status_code", "IN_PROGRESS"))
            if state in {"FINISHED", "ERROR", "EXPIRED"}:
                break
        if state != "FINISHED":
            if state in {"ERROR", "EXPIRED"}:
                raise SocialError(status_payload.get("status") or f"Instagram Reel 처리 상태가 {state}입니다.")
            return {"account": "Instagram", "id": container_id, "pending": True}
        published = request_json(
            f"{GRAPH_ROOT}/{ig_id}/media_publish", method="POST",
            form={"creation_id": container_id},
            headers={"Authorization": f"Bearer {page_token}"},
        )
        media_id = published.get("id")
        if not media_id:
            raise SocialError("Instagram이 게시물 ID를 반환하지 않았습니다.")
        url = ""
        try:
            media = request_json(
                f"{GRAPH_ROOT}/{media_id}?" + urlencode({"fields": "permalink"}),
                headers={"Authorization": f"Bearer {page_token}"},
            )
            url = media.get("permalink", "")
        except SocialError:
            pass
        return {"account": "Instagram", "id": media_id, "url": url}

    def _publish_tiktok(self, file_path: Path, metadata: dict[str, Any], info: dict[str, Any]) -> dict[str, Any]:
        tokens = self._access_tokens("tiktok")
        token = tokens["access_token"]
        creator = self.tiktok_creator_info()
        max_duration = int(creator.get("max_video_post_duration_sec", 0) or 0)
        if max_duration and info["duration"] > max_duration:
            raise SocialError(f"이 TikTok 계정의 동영상 제한은 {max_duration}초입니다.")
        options = creator.get("privacy_level_options", [])
        privacy = metadata.get("tiktok_privacy", "SELF_ONLY")
        if not isinstance(options, list) or not options:
            raise SocialError("TikTok 계정에서 허용하는 공개 범위를 가져오지 못했습니다. 다시 시도해 주세요.")
        if not isinstance(privacy, str) or privacy not in options:
            raise SocialError("TikTok 계정에서 허용된 공개 범위 중 하나를 선택해 주세요.")
        caption = metadata.get("tiktok_caption", metadata.get("caption", ""))
        title = metadata.get("tiktok_title") or caption
        if not isinstance(title, str) or len(title.encode("utf-16-le")) // 2 > 2200:
            raise SocialError("TikTok 캡션은 UTF-16 기준 2,200자 이하여야 합니다.")
        if not isinstance(caption, str):
            raise SocialError("TikTok 캡션을 확인해 주세요.")
        for key in (
            "tiktok_disable_duet", "tiktok_disable_comment", "tiktok_disable_stitch",
            "tiktok_is_aigc", "tiktok_brand_content", "tiktok_brand_organic",
        ):
            if key in metadata and not isinstance(metadata[key], bool):
                raise SocialError("TikTok 게시 옵션을 확인해 주세요.")
        size = file_path.stat().st_size
        chunk_size = min(TIKTOK_CHUNK_BYTES, size)
        chunk_count = math.ceil(size / chunk_size)
        post_info = {
            "title": title,
            "privacy_level": privacy,
            "disable_duet": bool(metadata.get("tiktok_disable_duet", False)),
            "disable_comment": bool(metadata.get("tiktok_disable_comment", False)),
            "disable_stitch": bool(metadata.get("tiktok_disable_stitch", False)),
            "video_cover_timestamp_ms": 1000,
            "brand_content_toggle": bool(metadata.get("tiktok_brand_content", False)),
            "brand_organic_toggle": bool(metadata.get("tiktok_brand_organic", False)),
        }
        if metadata.get("tiktok_is_aigc"):
            post_info["is_aigc"] = True
        init = request_json(
            "https://open.tiktokapis.com/v2/post/publish/video/init/",
            method="POST",
            payload={
                "post_info": post_info,
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": size,
                    "chunk_size": chunk_size,
                    "total_chunk_count": chunk_count,
                },
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        data = init.get("data", {})
        publish_id = data.get("publish_id")
        upload_url = data.get("upload_url")
        if not publish_id or not upload_url:
            raise SocialError(_remote_error_message(init, "TikTok 업로드 세션을 만들지 못했습니다."))
        for index in range(chunk_count):
            offset = index * chunk_size
            length = min(chunk_size, size - offset)
            end = offset + length - 1
            status, _response_headers, body = stream_file_request(
                upload_url,
                "PUT",
                {
                    "Content-Type": "video/mp4",
                    "Content-Range": f"bytes {offset}-{end}/{size}",
                },
                file_path,
                offset=offset,
                length=length,
                timeout=900,
            )
            if status < 200 or status >= 300:
                raise SocialError(_remote_error_message(_read_json_response(body), f"TikTok returned HTTP {status} during video upload."))

        current = "PROCESSING_UPLOAD"
        last_status: dict[str, Any] = {}
        for _ in range(90):
            time.sleep(2)
            last_status = request_json(
                "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
                method="POST",
                payload={"publish_id": publish_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            status_data = last_status.get("data", {})
            current = str(status_data.get("status", "PROCESSING_UPLOAD"))
            if current in {"PUBLISH_COMPLETE", "FAILED", "SEND_TO_USER_INBOX", "EXPIRED"}:
                break
        if current == "SEND_TO_USER_INBOX":
            return {"account": "TikTok", "id": publish_id, "pending": True, "action_required": True}
        if current not in {"PUBLISH_COMPLETE", "FAILED", "EXPIRED"}:
            return {"account": "TikTok", "id": publish_id, "pending": True}
        if current != "PUBLISH_COMPLETE":
            status_data = last_status.get("data", {})
            reason = status_data.get("fail_reason") or status_data.get("status_msg") or current
            raise SocialError(f"TikTok 게시 상태: {reason}")
        return {"account": "TikTok", "id": publish_id}
