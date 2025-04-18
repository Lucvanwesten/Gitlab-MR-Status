document.getElementById('save').addEventListener('click', () => {
    const token = document.getElementById('token').value.trim();
    chrome.storage.sync.set({ gitlabToken: token }, () => {
        alert('GitLab token saved.');
    });
});

window.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get('gitlabToken', (data) => {
        if (data.gitlabToken) {
            document.getElementById('token').value = data.gitlabToken;
        }
    });
});