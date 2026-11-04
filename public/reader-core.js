export function resolveRoute(search, config, pageCount) {
  const params = new URLSearchParams(search);
  const issueId = params.get('issue') || config.defaultIssue;
  const issue = config.editions.find(e => e.id === issueId);
  if (!issue) {
    if (config.removedIssueIds?.includes(issueId)) return { error: 'deleted', issueId };
    if (!params.get('issue') && !config.editions.length) return { error: 'empty', issueId };
    if (!params.get('issue') && !config.defaultIssue) return { error: 'no-default', issueId };
    return { error: 'issue', issueId };
  }
  const raw = params.get('page');
  const requested = raw === null ? 1 : /^\d+$/.test(raw) ? Number(raw) : 1;
  const safe = Number.isSafeInteger(requested) ? requested : 1;
  const page = Math.min(Math.max(safe, 1), pageCount || Number.MAX_SAFE_INTEGER);
  return { issue, page, corrected: raw !== null && (String(page) !== raw) };
}

export function pageLink(base, issueId, page) {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('issue', issueId);
  url.searchParams.set('page', String(page));
  return url.href;
}

export function validateIssueId(id) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/.test(id);
}

export function mergeEditions(config, drafts, defaultId) {
  const editions = config.editions.filter(e => !e.isDemo || !drafts.length).map(e => ({...e}));
  for (const draft of drafts) {
    if (!validateIssueId(draft.id)) throw new Error('발행 호 ID를 확인해 주세요.');
    if (editions.some(e => e.id === draft.id)) throw new Error('기존 호와 같은 ID는 사용할 수 없습니다: ' + draft.id);
    editions.push({id:draft.id, title:draft.title, label:draft.label, pdf:'papers/'+draft.id+'.pdf', pageCount:draft.pageCount, isDemo:false});
  }
  const nextDefault = defaultId || config.defaultIssue;
  if (!editions.some(e => e.id === nextDefault)) throw new Error('기본으로 열 신문을 지정해 주세요.');
  return {...config, defaultIssue:nextDefault, editions};
}
