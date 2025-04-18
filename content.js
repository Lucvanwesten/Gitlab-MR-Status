(async function() {
    // Don’t run on GitLab’s own site
    const host = window.location.hostname;
    if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) return;

    const MR_REGEX      = /https:\/\/gitlab\.com\/(.+?)\/-\/merge_requests\/(\d+)/;
    const processedAttr = 'data-gitlab-mr-processed';

    function createStatusElement(statusText, threadsCount, failedJobs = []) {
        const container = document.createElement('div');
        container.style.fontSize = '0.9em';
        container.style.color    = '#555';

        let text = `Pipeline: ${statusText}`;
        if (failedJobs.length) text += ` | Failed jobs: ${failedJobs.join(', ')}`;
        text += ` | Unresolved threads: ${threadsCount}`;

        container.textContent = text;
        return container;
    }

    const getToken = () => new Promise(resolve =>
        chrome.storage.sync.get('gitlabToken', data => resolve(data.gitlabToken))
    );
    const token   = await getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    // Count unresolved discussion threads across all pages
    async function fetchUnresolvedThreads(encodedPath, mrIid) {
        let page = 1;
        let totalUnresolved = 0;

        while (true) {
            const url = `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/discussions?page=${page}&per_page=100`;
            const res = await fetch(url, { headers });
            if (!res.ok) break;

            const discussions = await res.json();
            // count any discussion where at least one note is resolvable but not yet resolved
            totalUnresolved += discussions.filter(d =>
                d.notes.some(n => n.resolvable === true && n.resolved === false)
            ).length;

            const totalPages = parseInt(res.headers.get('X-Total-Pages') || '1', 10);
            if (page >= totalPages) break;
            page += 1;
        }

        return totalUnresolved;
    }

    async function processLink(link) {
        if (link.hasAttribute(processedAttr)) return;
        link.setAttribute(processedAttr, 'true');

        const match = link.href.match(MR_REGEX);
        if (!match) return;
        const [, projectPath, mrIid] = match;
        const encodedPath = encodeURIComponent(projectPath);

        try {
            // Fetch MR details (state and head_pipeline)
            const mrRes = await fetch(
                `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}`,
                { headers }
            );
            const mr = mrRes.ok ? await mrRes.json() : {};
            const merged = mr.state === 'merged';

            let statusText;
            let failedJobs = [];

            if (merged) {
                statusText = 'Merged';
            } else {
                statusText = mr.head_pipeline?.status || 'unknown';
                if (mr.head_pipeline?.id && statusText === 'failed') {
                    const jobsRes = await fetch(
                        `https://gitlab.com/api/v4/projects/${encodedPath}/pipelines/${mr.head_pipeline.id}/jobs`,
                        { headers }
                    );
                    if (jobsRes.ok) {
                        const jobs = await jobsRes.json();
                        failedJobs = jobs.filter(j => j.status === 'failed').map(j => j.name);
                    }
                }
            }

            // Get unresolved threads count
            const unresolved = await fetchUnresolvedThreads(encodedPath, mrIid);

            // Render status
            const statusEl = createStatusElement(statusText, unresolved, failedJobs);
            link.after(statusEl);

        } catch (err) {
            console.error('GitLab MR Status error:', err);
        }
    }

    // Initial scan + observe dynamic content
    document.querySelectorAll('a[href*=\"/-/merge_requests/\"]').forEach(processLink);
    new MutationObserver(mutations => {
        mutations.forEach(({ addedNodes }) => {
            addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                if (node.tagName === 'A') processLink(node);
                else node.querySelectorAll?.('a[href*=\"/-/merge_requests/\"]').forEach(processLink);
            });
        });
    }).observe(document.body, { childList: true, subtree: true });
})();