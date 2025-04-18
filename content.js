(async function() {
    // Don’t run on GitLab’s own site
    const host = window.location.hostname;
    if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) return;

    const MR_REGEX = /https:\/\/gitlab\.com\/(.+?)\/-\/merge_requests\/(\d+)/;
    const processedAttr = 'data-gitlab-mr-processed';

    // Utility to create the status element
    function createStatusElement(statusText, threadsCount) {
        const container = document.createElement('div');
        container.style.fontSize = '0.9em';
        container.style.color = '#555';
        container.textContent = `Pipeline: ${statusText} | Unresolved threads: ${threadsCount}`;
        return container;
    }

    // Fetch token from storage
    const getToken = () => new Promise(resolve =>
        chrome.storage.sync.get('gitlabToken', data => resolve(data.gitlabToken))
    );

    const token = await getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    // Process a single link if not already done
    async function processLink(link) {
        if (link.hasAttribute(processedAttr)) return;
        link.setAttribute(processedAttr, 'true');

        const match = link.href.match(MR_REGEX);
        if (!match) return;

        const [_, projectPath, mrIid] = match;
        const encodedPath = encodeURIComponent(projectPath);

        try {
            // 1) Fetch MR details to see if it's merged
            const mrRes = await fetch(
                `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}`,
                { headers }
            );
            const mr = mrRes.ok ? await mrRes.json() : {};
            const isMerged = mr.state === 'merged';

            let statusText;
            if (isMerged) {
                statusText = 'Merged';
            } else {
                // 2) Only if not merged, fetch latest pipeline
                const pipelinesRes = await fetch(
                    `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/pipelines`,
                    { headers }
                );
                const pipelines = pipelinesRes.ok ? await pipelinesRes.json() : [];
                statusText = pipelines[0]?.status || 'unknown';
            }

            // 3) Fetch unresolved thread count as before
            const discussionsRes = await fetch(
                `https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/discussions`,
                { headers }
            );
            const discussions = discussionsRes.ok ? await discussionsRes.json() : [];
            const unresolved = discussions.filter(d => d.resolvable && !d.resolved).length;

            // 4) Render
            const statusEl = createStatusElement(statusText, unresolved);
            link.after(statusEl);

        } catch (err) {
            console.error('GitLab MR Status error:', err);
        }
    }

    // Initial scan
    document.querySelectorAll('a[href*="/-/merge_requests/"]').forEach(processLink);

    // Observe for dynamically added links (e.g., in React apps)
    const observer = new MutationObserver(mutations => {
        for (const { addedNodes } of mutations) {
            addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                if (node.tagName === 'A') {
                    processLink(node);
                } else {
                    node.querySelectorAll?.('a[href*="/-/merge_requests/"]').forEach(processLink);
                }
            });
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();