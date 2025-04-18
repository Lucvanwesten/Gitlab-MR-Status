(async function() {
    // Don’t run on GitLab’s own site
    const host = window.location.hostname;
    if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) return;

    const MR_REGEX       = /https:\/\/gitlab\.com\/(.+?)\/-\/merge_requests\/(\d+)/;
    const processedAttr  = 'data-gitlab-mr-processed';

    // ——— build the status element ———
    function createStatusElement(statusText, threadsCount, failedJobs = []) {
        const container = document.createElement('div');
        container.style.fontSize = '0.9em';
        container.style.color    = '#555';

        let text = `Pipeline: ${statusText}`;
        if (failedJobs.length) {
            text += ` | Failed jobs: ${failedJobs.join(', ')}`;
        }
        text += ` | Unresolved threads: ${threadsCount}`;

        container.textContent = text;
        return container;
    }

    // ——— grab your token ———
    const getToken = () =>
        new Promise(resolve =>
            chrome.storage.sync.get('gitlabToken', data => resolve(data.gitlabToken))
        );
    const token   = await getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    // ——— process each MR link ———
    async function processLink(link) {
        if (link.hasAttribute(processedAttr)) return;
        link.setAttribute(processedAttr, 'true');

        const m = link.href.match(MR_REGEX);
        if (!m) return;
        const [, projectPath, mrIid] = m;
        const encodedPath = encodeURIComponent(projectPath);

        try {
            // 1) See if it's merged
            const mrRes  = await fetch(
                `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}`,
                { headers }
            );
            const mr     = mrRes.ok ? await mrRes.json() : {};
            const merged = mr.state === 'merged';

            let statusText, failedJobs = [];

            if (merged) {
                statusText = 'Merged';
            } else {
                // 2) Get latest pipeline
                const pipeRes   = await fetch(
                    `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/pipelines`,
                    { headers }
                );
                const pipelines = pipeRes.ok ? await pipeRes.json() : [];
                const latest    = pipelines[0];
                statusText      = latest?.status || 'unknown';

                // 3) If it failed, list the jobs that failed
                if (latest && statusText === 'failed') {
                    const jobsRes = await fetch(
                        `https://gitlab.com/api/v4/projects/${encodedPath}/pipelines/${latest.id}/jobs`,
                        { headers }
                    );
                    if (jobsRes.ok) {
                        const jobs = await jobsRes.json();
                        failedJobs = jobs
                            .filter(j => j.status === 'failed')
                            .map(j => j.name);
                    }
                }
            }

            // 4) Still pull unresolved threads as before
            const discRes     = await fetch(
                `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/discussions`,
                { headers }
            );
            const discussions = discRes.ok ? await discRes.json() : [];
            const unresolved  = discussions.filter(d => d.resolvable && !d.resolved).length;

            // 5) Render
            const el = createStatusElement(statusText, unresolved, failedJobs);
            link.after(el);

        } catch (err) {
            console.error('GitLab MR Status error:', err);
        }
    }

    // initial scan + React‑friendly observer
    document.querySelectorAll('a[href*="/-/merge_requests/"]').forEach(processLink);
    new MutationObserver(muts => {
        muts.forEach(({ addedNodes }) =>
            addedNodes.forEach(n => {
                if (n.nodeType !== 1) return;
                if (n.tagName === 'A') processLink(n);
                else n.querySelectorAll?.('a[href*="/-/merge_requests/"]').forEach(processLink);
            })
        );
    }).observe(document.body, { childList: true, subtree: true });
})();