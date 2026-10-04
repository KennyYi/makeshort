import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "./i18n.js";

const PROVIDERS = [
  { id: "youtube", label: "YouTube Shorts", short: "YouTube", clientLabel: "OAuth Client ID", setup: t("Google Cloud에서 YouTube Data API v3를 켜고 Web application OAuth 클라이언트를 만드세요. Authorized redirect URI를 아래 주소로 등록하고, OAuth 동의 화면의 테스트 사용자에 본인 계정을 추가하세요.") },
  { id: "instagram", label: "Instagram Reels", short: "Instagram", clientLabel: "Meta App ID", setup: t("Meta 개발자 앱에 Facebook Login과 Instagram Graph API를 추가하세요. Instagram Business 또는 Creator 계정이 Facebook Page에 연결되어 있어야 합니다. 앱 검수 전에는 앱 역할이 있는 계정만 연결할 수 있습니다.") },
  { id: "tiktok", label: "TikTok", short: "TikTok", clientLabel: "Client Key", setup: t("TikTok for Developers 앱에 Login Kit와 Content Posting API를 추가하고, Desktop redirect URI를 등록하세요. video.publish 권한 승인과 앱 검수가 필요합니다. 검수 전 게시물은 비공개로 제한될 수 있습니다.") },
];

const PRIVACY_LABELS = {
  PUBLIC_TO_EVERYONE: t("모든 사람"),
  MUTUAL_FOLLOW_FRIENDS: t("맞팔 친구"),
  FOLLOWER_OF_CREATOR: t("팔로워"),
  SELF_ONLY: t("나만 보기"),
};
const LOCAL_ORIGINS = new Set(["http://127.0.0.1:8000", "http://localhost:8000"]);

const encodeJson = (value) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const requestJson = async (url, options) => {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(t(payload.error || "요청에 실패했습니다."));
  return payload;
};

const formatFileSize = (bytes) => bytes < 1_000_000
  ? `${Math.max(1, Math.round(bytes / 1000))} KB`
  : `${(bytes / 1_000_000).toFixed(1)} MB`;

export const SocialDistribution = ({ renderedBlob, renderedUrl, videoTitle, duration }) => {
  const [status, setStatus] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [credentials, setCredentials] = useState({});
  const [targets, setTargets] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupEditor, setGroupEditor] = useState(null);
  const [groupName, setGroupName] = useState("");
  const [groupAccounts, setGroupAccounts] = useState({});
  const [metadata, setMetadata] = useState({
    youtube_title: videoTitle,
    youtube_description: "",
    youtube_privacy: "private",
    instagram_caption: videoTitle,
    instagram_share_to_feed: true,
    tiktok_caption: videoTitle,
    tiktok_privacy: "SELF_ONLY",
    tiktok_disable_comment: false,
    tiktok_disable_duet: false,
    tiktok_disable_stitch: false,
    tiktok_is_aigc: false,
    tiktok_brand_content: false,
    tiktok_brand_organic: false,
  });
  const [creatorInfo, setCreatorInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [results, setResults] = useState([]);
  const oauthPolls = useRef(new Set());

  const loadStatus = useCallback(async () => {
    const current = await requestJson("/api/social/status");
    setStatus(current);
    setSelectedGroupId((selected) => current.groups?.some((group) => group.id === selected)
      ? selected
      : current.groups?.[0]?.id || "");
    return current;
  }, []);

  useEffect(() => {
    loadStatus().catch((loadError) => setError(t(loadError.message)));
  }, [loadStatus]);

  useEffect(() => {
    const onMessage = (event) => {
      if (!LOCAL_ORIGINS.has(event.origin) || event.data?.type !== "makeshort-social-oauth") return;
      setNotice(t(event.data.message || (event.data.ok ? "계정을 연결했습니다." : "계정 연결에 실패했습니다.")));
      if (!event.data.ok) setError(t(event.data.message || "계정 연결에 실패했습니다."));
      loadStatus().catch((loadError) => setError(t(loadError.message)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadStatus]);

  useEffect(() => () => {
    oauthPolls.current.forEach((timer) => window.clearInterval(timer));
    oauthPolls.current.clear();
  }, []);

  useEffect(() => {
    setMetadata((current) => ({
      ...current,
      youtube_title: current.youtube_title || videoTitle,
      instagram_caption: current.instagram_caption || videoTitle,
      tiktok_caption: current.tiktok_caption || videoTitle,
    }));
  }, [videoTitle]);

  const connectedCount = useMemo(() => PROVIDERS.reduce((count, { id }) => (
    count + (status?.providers?.[id]?.accounts || []).filter((account) => account.connected).length
  ), 0), [status]);
  const selectedGroup = useMemo(
    () => status?.groups?.find((group) => group.id === selectedGroupId) || null,
    [status, selectedGroupId],
  );
  const updateMetadata = (patch) => setMetadata((current) => ({ ...current, ...patch }));
  const accountName = (provider, accountId) => status?.providers?.[provider]?.accounts?.find((account) => account.id === accountId)?.name || t("계정 미설정");

  const saveCredentials = async (provider) => {
    const form = credentials[provider] || {};
    setSaving(provider);
    setError("");
    setNotice("");
    try {
      const next = await requestJson("/api/social/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, client_id: form.clientId, client_secret: form.clientSecret }),
      });
      setStatus(next);
      setCredentials((current) => ({ ...current, [provider]: { clientId: form.clientId, clientSecret: "" } }));
      setNotice(t("앱 키를 macOS 키체인에 저장했습니다."));
    } catch (saveError) {
      setError(t(saveError.message));
    } finally {
      setSaving("");
    }
  };

  const connect = (provider) => {
    setError("");
    setNotice("");
    const popup = window.open(`/oauth/${provider}/start`, `makeshort-${provider}-oauth`, "popup,width=560,height=760");
    if (!popup) setError(t("인증 창이 열리지 않았습니다. 브라우저에서 팝업을 허용해 주세요."));
    else {
      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          oauthPolls.current.delete(timer);
          loadStatus().then((next) => {
            const count = next.providers?.[provider]?.accounts?.filter((account) => account.connected).length || 0;
            if (count) setNotice(t("{label} 계정 {count}개를 사용할 수 있습니다.", { label: next.providers[provider].label, count }));
          }).catch((loadError) => setError(t(loadError.message)));
        }
      }, 700);
      oauthPolls.current.add(timer);
    }
  };

  const disconnectAccount = async (provider, accountId) => {
    setSaving(provider);
    setError("");
    try {
      const next = await requestJson("/api/social/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, account_id: accountId }),
      });
      setStatus(next);
      setNotice(t("{label} 계정 연결을 해제했습니다.", { label: next.providers?.[provider]?.label || provider }));
    } catch (disconnectError) {
      setError(t(disconnectError.message));
    } finally {
      setSaving("");
    }
  };

  const startGroupEditor = (group = null) => {
    setGroupEditor(group ? { id: group.id } : { id: null });
    setGroupName(group?.name || "");
    setGroupAccounts(group?.accounts ? { ...group.accounts } : {});
    setError("");
  };

  const saveGroup = async () => {
    setSaving("groups");
    setError("");
    try {
      const next = await requestJson("/api/social/groups/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName, id: groupEditor?.id || undefined, accounts: groupAccounts }),
      });
      setStatus(next);
      const savedGroup = next.groups?.find((group) => (groupEditor?.id
        ? group.id === groupEditor.id
        : group.name === groupName.trim() && PROVIDERS.every(({ id }) => (group.accounts?.[id] || "") === (groupAccounts[id] || ""))));
      setSelectedGroupId(savedGroup?.id || next.groups?.[0]?.id || "");
      setGroupEditor(null);
      setNotice(t("계정 그룹을 저장했습니다."));
    } catch (saveError) {
      setError(t(saveError.message));
    } finally {
      setSaving("");
    }
  };

  const deleteGroup = async (groupId) => {
    setSaving("groups");
    setError("");
    try {
      const next = await requestJson("/api/social/groups/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: groupId }),
      });
      setStatus(next);
      setSelectedGroupId(next.groups?.[0]?.id || "");
      setGroupEditor(null);
      setNotice(t("계정 그룹을 삭제했습니다."));
    } catch (deleteError) {
      setError(t(deleteError.message));
    } finally {
      setSaving("");
    }
  };

  const selectGroupForPublish = (groupId) => {
    setSelectedGroupId(groupId);
    const group = status?.groups?.find((item) => item.id === groupId);
    setTargets(PROVIDERS.filter(({ id }) => {
      const accountId = group?.accounts?.[id];
      return accountId && status?.providers?.[id]?.accounts?.some((account) => account.id === accountId && account.connected);
    }).map(({ id }) => id));
  };

  const openPublish = () => {
    setError("");
    setNotice("");
    setResults([]);
    const firstGroup = status?.groups?.find((group) => group.id === selectedGroupId) || status?.groups?.[0];
    setSelectedGroupId(firstGroup?.id || "");
    setTargets(PROVIDERS.filter(({ id }) => {
      const accountId = firstGroup?.accounts?.[id];
      return accountId && status?.providers?.[id]?.accounts?.some((account) => account.id === accountId && account.connected);
    }).map(({ id }) => id));
    setPublishOpen(true);
  };

  const tiktokAccountId = selectedGroup?.accounts?.tiktok || "";
  useEffect(() => {
    if (!publishOpen || !targets.includes("tiktok") || !tiktokAccountId) {
      setCreatorInfo(null);
      return undefined;
    }
    let cancelled = false;
    requestJson("/api/social/tiktok/creator-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: tiktokAccountId }),
    }).then((data) => {
      if (cancelled) return;
      setCreatorInfo(data);
      const options = data.privacy_level_options || [];
      setMetadata((current) => ({
        ...current,
        tiktok_privacy: options.includes(current.tiktok_privacy)
          ? current.tiktok_privacy
          : options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0] || "SELF_ONLY",
        tiktok_disable_comment: Boolean(data.comment_disabled || current.tiktok_disable_comment),
        tiktok_disable_duet: Boolean(data.duet_disabled || current.tiktok_disable_duet),
        tiktok_disable_stitch: Boolean(data.stitch_disabled || current.tiktok_disable_stitch),
      }));
    }).catch((creatorError) => {
      if (!cancelled) setError(t("TikTok 게시 설정을 가져오지 못했습니다: {message}", { message: creatorError.message }));
    });
    return () => { cancelled = true; };
  }, [publishOpen, selectedGroupId, targets.join(","), tiktokAccountId]);

  const publish = async () => {
    if (!renderedBlob) return;
    if (!targets.length) {
      setError(t("선택한 그룹에 계정을 연결한 플랫폼을 하나 이상 선택해 주세요."));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setResults([]);
    try {
      const response = await requestJson("/api/social/publish", {
        method: "POST",
        headers: {
          "Content-Type": "video/mp4",
          "X-Makeshort-Publish": encodeJson({ group_id: selectedGroupId, targets, metadata }),
        },
        body: renderedBlob,
      });
      setResults(response.results || []);
      const completed = (response.results || []).filter((item) => item.ok && !item.pending).length;
      const pending = (response.results || []).filter((item) => item.ok && item.pending).length;
      const failures = (response.results || []).length - completed - pending;
      const summary = [t("{count}개 게시 완료", { count: completed }), ...(pending ? [t("{count}개 처리 중", { count: pending })] : []), ...(failures ? [t("{count}개 실패", { count: failures })] : [])];
      setNotice(summary.join(" · "));
      await loadStatus();
    } catch (publishError) {
      setError(t(publishError.message));
    } finally {
      setBusy(false);
    }
  };

  const toggleTarget = (provider) => setTargets((current) => current.includes(provider)
    ? current.filter((item) => item !== provider)
    : [...current, provider]);

  return (
    <>
      <div className="social-actions">
        <button type="button" className="quiet-button social-settings-button" onClick={() => { setError(""); setSettingsOpen(true); }}>
          {t("계정 설정")} <span className="social-count">{t("{count}개", { count: connectedCount })}</span>
        </button>
        <button type="button" className="social-publish-button" onClick={openPublish} disabled={!renderedBlob || busy}>
          {t("플랫폼 배포")} <span aria-hidden="true">↗</span>
        </button>
      </div>

      {settingsOpen && (
        <div className="social-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="social-modal" role="dialog" aria-modal="true" aria-labelledby="social-settings-title">
            <header className="social-modal-heading"><div><span className="section-index">{t("로컬 계정")}</span><h3 id="social-settings-title">{t("배포 계정 연결")}</h3></div><button type="button" className="social-close" onClick={() => setSettingsOpen(false)} aria-label={t("닫기")}>×</button></header>
            <p className="social-modal-intro">{t("앱 자격 증명과 OAuth 토큰은 이 컴퓨터에 저장됩니다. 토큰과 Secret은 시스템 키체인에, 계정 이름과 선택 정보는 {path}에 보관합니다.", { path: status?.data_location || "~/.makeshort" })}</p>
            {!status?.keyring_available && <div className="social-warning">{t("macOS 키체인을 사용할 수 없습니다. Python requirements를 설치하고 키체인 잠금 상태를 확인해 주세요.")}</div>}
            <div className="social-provider-list">
              {PROVIDERS.map((provider) => {
                const account = status?.providers?.[provider.id] || {};
                const fields = credentials[provider.id] || {};
                return (
                  <article className="social-provider-card" key={provider.id}>
                    <div className="social-provider-title">
                      <div><strong>{provider.label}</strong><span>{t("{count}개 계정 연결", { count: (account.accounts || []).filter((item) => item.connected).length })}</span></div>
                      <span className={`social-state ${account.connected ? "connected" : ""}`}>{account.connected ? t("연결됨") : t("미연결")}</span>
                    </div>
                    <details className="social-setup-help"><summary>{t("앱 설정 방법")}</summary><p>{provider.setup}</p><code>http://127.0.0.1:8000/oauth/{provider.id}/callback</code></details>
                    <div className="social-credential-grid">
                      <label><span>{provider.clientLabel}</span><input type="text" autoComplete="off" value={fields.clientId || ""} onChange={(event) => setCredentials((current) => ({ ...current, [provider.id]: { ...current[provider.id], clientId: event.target.value } }))} placeholder={account.configured ? "저장됨 · 변경할 때만 입력" : "개발자 콘솔에서 발급"} /></label>
                      <label><span>Client Secret</span><input type="password" autoComplete="new-password" value={fields.clientSecret || ""} onChange={(event) => setCredentials((current) => ({ ...current, [provider.id]: { ...current[provider.id], clientSecret: event.target.value } }))} placeholder={account.configured ? "저장됨 · 변경할 때만 입력" : "키체인에 안전하게 저장"} /></label>
                    </div>
                    <div className="social-provider-actions">
                      <button type="button" className="quiet-button" disabled={saving === provider.id || !fields.clientId || !fields.clientSecret || !status?.keyring_available} onClick={() => saveCredentials(provider.id)}>{saving === provider.id ? t("저장 중…") : t("앱 키 저장")}</button>
                      <button type="button" className="small-add-button" disabled={!account.configured || saving === provider.id} onClick={() => connect(provider.id)}>{account.accounts?.length ? t("다른 계정 추가") : t("계정 연결")}</button>
                    </div>
                    {account.accounts?.length > 0 && <div className="social-connected-accounts">
                      {account.accounts.map((item) => <div className="social-connected-account" key={item.id}>
                        <span><strong>{item.name}</strong><small>{item.connected ? t("연결됨 · 그룹에 추가할 수 있음") : t("다시 연결 필요")}</small></span>
                        <button type="button" className="social-disconnect" disabled={saving === provider.id} onClick={() => disconnectAccount(provider.id, item.id)}>{t("연결 해제")}</button>
                      </div>)}
                    </div>}
                  </article>
                );
              })}
            </div>
            <section className="social-group-manager" aria-labelledby="social-groups-title">
              <header><div><strong id="social-groups-title">{t("배포 그룹")}</strong><small>{t("영상마다 어느 플랫폼 계정으로 올릴지 묶어 둡니다.")}</small></div><button type="button" className="small-add-button" disabled={saving === "groups"} onClick={() => startGroupEditor()}>{t("그룹 추가")}</button></header>
              {(status?.groups || []).length === 0 && <p className="social-group-empty">{t("계정을 하나 이상 연결한 뒤 그룹을 만들어 주세요.")}</p>}
              {(status?.groups || []).map((group) => <article className="social-group-card" key={group.id}>
                <div><strong>{group.name}</strong><small>{PROVIDERS.map((provider) => group.accounts?.[provider.id] ? `${provider.short}: ${accountName(provider.id, group.accounts[provider.id])}` : null).filter(Boolean).join(" · ") || t("계정이 지정되지 않음")}</small></div>
                <div className="social-group-actions"><button type="button" className="quiet-button" disabled={saving === "groups"} onClick={() => startGroupEditor(group)}>{t("수정")}</button><button type="button" className="social-disconnect" disabled={saving === "groups"} onClick={() => deleteGroup(group.id)}>{t("삭제")}</button></div>
              </article>)}
              {groupEditor && <div className="social-group-editor">
                <label><span>{t("그룹 이름")}</span><input type="text" maxLength="60" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={t("예: 음악 계정")} /></label>
                <div className="social-group-account-grid">{PROVIDERS.map((provider) => {
                  const accounts = (status?.providers?.[provider.id]?.accounts || []).filter((item) => item.connected);
                  return <label key={provider.id}><span>{provider.short}</span><select value={groupAccounts[provider.id] || ""} onChange={(event) => setGroupAccounts((current) => ({ ...current, [provider.id]: event.target.value || "" }))}>
                    <option value="">{t("사용 안 함")}</option>{accounts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                  </select></label>;
                })}</div>
                <div className="social-group-actions"><button type="button" className="small-add-button" disabled={saving === "groups" || !groupName.trim()} onClick={saveGroup}>{saving === "groups" ? t("저장 중…") : t("그룹 저장")}</button><button type="button" className="quiet-button" disabled={saving === "groups"} onClick={() => setGroupEditor(null)}>{t("취소")}</button></div>
              </div>}
            </section>
            {notice && <p className="social-notice" role="status">{notice}</p>}
            {error && <p className="social-error" role="alert">{error}</p>}
            <footer className="social-modal-footer"><span>{t("게시물은 플랫폼으로 직접 업로드됩니다. 연결된 계정의 공개 권한은 게시 화면에서 확인하세요.")}</span><button type="button" className="quiet-button" onClick={() => setSettingsOpen(false)}>{t("닫기")}</button></footer>
          </section>
        </div>
      )}

      {publishOpen && (
        <div className="social-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPublishOpen(false); }}>
          <section className="social-modal publish-modal" role="dialog" aria-modal="true" aria-labelledby="social-publish-title">
            <header className="social-modal-heading"><div><span className="section-index">{t("검토 및 배포")}</span><h3 id="social-publish-title">{t("영상 확인 후 배포")}</h3></div><button type="button" className="social-close" onClick={() => !busy && setPublishOpen(false)} aria-label={t("닫기")}>×</button></header>
            <p className="social-modal-intro">{t("완성된 {duration}초 영상 · {size}. 최종 출력물을 확인한 뒤 선택한 계정에 게시하세요.", { duration: Math.round(duration), size: renderedBlob ? formatFileSize(renderedBlob.size) : "" })}</p>
            {renderedUrl && <video className="publish-video-review" src={renderedUrl} controls playsInline preload="metadata" aria-label={t("게시할 최종 영상 미리보기")} />}
            {renderedBlob?.size > 1_000_000_000 && <div className="social-warning">{t("현재 로컬 업로드는 영상당 1GB까지 지원합니다. 영상 길이나 출력 크기를 줄여 다시 합성해 주세요.")}</div>}
            <label className="publish-group-selector"><span>{t("배포 계정 그룹")}</span><select value={selectedGroupId} disabled={busy || !(status?.groups || []).length} onChange={(event) => selectGroupForPublish(event.target.value)}>
              {(status?.groups || []).length === 0 && <option value="">{t("그룹 없음 · 계정 설정에서 추가")}</option>}
              {(status?.groups || []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select></label>
            {!status?.groups?.length && <div className="social-warning">{t("먼저 계정 설정에서 배포 그룹을 만들고, 플랫폼별 계정을 지정해 주세요.")}</div>}
            <div className="publish-targets" role="group" aria-label={t("배포 플랫폼")}>
              {PROVIDERS.map((provider) => {
                const accountId = selectedGroup?.accounts?.[provider.id];
                const account = status?.providers?.[provider.id]?.accounts?.find((item) => item.id === accountId);
                const available = Boolean(account?.connected);
                return <label className={`publish-target ${targets.includes(provider.id) ? "selected" : ""} ${!available ? "unavailable" : ""}`} key={provider.id}>
                  <input type="checkbox" checked={targets.includes(provider.id)} disabled={!available || busy} onChange={() => toggleTarget(provider.id)} />
                  <span><strong>{provider.label}</strong><small>{available ? account.name : t("이 그룹에 연결된 계정 없음")}</small></span>
                </label>;
              })}
            </div>
            {targets.includes("youtube") && <div className="publish-fields">
              <label><span>{t("YouTube 제목")}</span><input maxLength="100" value={metadata.youtube_title} onChange={(event) => updateMetadata({ youtube_title: event.target.value })} /></label>
              <label><span>{t("YouTube 설명")}</span><textarea rows="2" maxLength="5000" value={metadata.youtube_description} onChange={(event) => updateMetadata({ youtube_description: event.target.value })} placeholder={t("선택 사항")} /></label>
              <label><span>{t("공개 범위")}</span><select value={metadata.youtube_privacy} onChange={(event) => updateMetadata({ youtube_privacy: event.target.value })}><option value="private">{t("비공개")}</option><option value="unlisted">{t("일부 공개")}</option><option value="public">{t("공개")}</option></select></label>
              <small>{t("YouTube는 세로 또는 정사각형 영상, 3분 이하를 Shorts로 분류합니다. 미검수 API 프로젝트는 업로드가 비공개로 제한될 수 있습니다.")}</small>
            </div>}
            {targets.includes("instagram") && <div className="publish-fields">
              <label><span>{t("Instagram Reels 캡션")}</span><textarea rows="3" maxLength="2200" value={metadata.instagram_caption} onChange={(event) => updateMetadata({ instagram_caption: event.target.value })} /></label>
              <label className="publish-check"><input type="checkbox" checked={metadata.instagram_share_to_feed} onChange={(event) => updateMetadata({ instagram_share_to_feed: event.target.checked })} /><span>{t("프로필 피드에도 공유")}</span></label>
            </div>}
            {targets.includes("tiktok") && <div className="publish-fields">
              <label><span>{t("TikTok 캡션")}</span><textarea rows="3" maxLength="2200" value={metadata.tiktok_caption} onChange={(event) => updateMetadata({ tiktok_caption: event.target.value })} /></label>
              <label><span>{t("공개 범위")}</span><select value={metadata.tiktok_privacy} onChange={(event) => updateMetadata({ tiktok_privacy: event.target.value })}>
                {(creatorInfo?.privacy_level_options || ["SELF_ONLY"]).map((option) => <option key={option} value={option}>{PRIVACY_LABELS[option] || option}</option>)}
              </select></label>
              <div className="publish-check-row">
                <label className="publish-check"><input type="checkbox" checked={metadata.tiktok_disable_comment} disabled={Boolean(creatorInfo?.comment_disabled) || busy} onChange={(event) => updateMetadata({ tiktok_disable_comment: event.target.checked })} /><span>{t("댓글 끄기")}</span></label>
                <label className="publish-check"><input type="checkbox" checked={metadata.tiktok_disable_duet} disabled={Boolean(creatorInfo?.duet_disabled) || busy} onChange={(event) => updateMetadata({ tiktok_disable_duet: event.target.checked })} /><span>{t("듀엣 끄기")}</span></label>
                <label className="publish-check"><input type="checkbox" checked={metadata.tiktok_disable_stitch} disabled={Boolean(creatorInfo?.stitch_disabled) || busy} onChange={(event) => updateMetadata({ tiktok_disable_stitch: event.target.checked })} /><span>{t("이어붙이기 끄기")}</span></label>
              </div>
              <label className="publish-check"><input type="checkbox" checked={metadata.tiktok_is_aigc} onChange={(event) => updateMetadata({ tiktok_is_aigc: event.target.checked })} /><span>{t("AI 생성 콘텐츠로 표시")}</span></label>
              <label className="publish-check"><input type="checkbox" checked={metadata.tiktok_brand_content} onChange={(event) => updateMetadata({ tiktok_brand_content: event.target.checked })} /><span>{t("브랜드 협찬 콘텐츠")}</span></label>
              <label className="publish-check"><input type="checkbox" checked={metadata.tiktok_brand_organic} onChange={(event) => updateMetadata({ tiktok_brand_organic: event.target.checked })} /><span>{t("내 비즈니스 홍보 콘텐츠")}</span></label>
              {creatorInfo?.max_video_post_duration_sec && <small>{t("이 계정의 최대 영상 길이: {duration}초", { duration: creatorInfo.max_video_post_duration_sec })}</small>}
            </div>}
            {notice && <p className="social-notice" role="status">{notice}</p>}
            {error && <p className="social-error" role="alert">{error}</p>}
            {results.length > 0 && <div className="publish-results" aria-live="polite">{results.map((result) => <div key={result.provider} className={!result.ok ? "failed" : result.pending ? "pending" : "success"}><strong>{result.account_name || PROVIDERS.find((item) => item.id === result.provider)?.label}</strong><span>{!result.ok ? t(result.error || "요청에 실패했습니다.") : result.pending ? `${result.action_required ? t("TikTok 앱에서 이어서 게시해 주세요") : t("플랫폼에서 처리 중입니다")} · ${result.id}` : result.url ? <a href={result.url} target="_blank" rel="noreferrer">{t("게시물 열기 ↗")}</a> : t("게시 완료 · {id}", { id: result.id })}</span></div>)}</div>}
            <footer className="social-modal-footer"><span>{t("게시가 시작되면 각 플랫폼에서 처리하며, 일부 실패가 있어도 나머지 플랫폼 게시 결과는 유지됩니다.")}</span><button type="button" className="social-publish-button" disabled={busy || !selectedGroupId || !targets.length || !renderedBlob || renderedBlob.size > 1_000_000_000} onClick={publish}>{busy ? t("플랫폼에 업로드 중…") : t("선택한 계정에 게시")}</button></footer>
          </section>
        </div>
      )}
    </>
  );
};
