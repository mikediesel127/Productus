document.addEventListener('DOMContentLoaded', () => {
    const projectNameInput = document.getElementById('projectName');
    const scriptTextarea = document.getElementById('script');
    const createProjectButton = document.getElementById('createProjectButton');
    const generateVideoButton = document.getElementById('generateVideoButton');
    const projectList = document.getElementById('projects');
    const statusBanner = document.getElementById('statusBanner');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const scriptPaceInput = document.getElementById('scriptPace');

    function showStatus(message, isError = false) {
        statusBanner.textContent = message;
        statusBanner.style.backgroundColor = isError ? '#e74c3c' : '#3498db';
        statusBanner.style.display = 'block';
        setTimeout(() => {
            statusBanner.style.display = 'none';
        }, 5000);
    }

    function updateProgress(percent, message) {
        progressBar.style.width = `${percent}%`;
        progressText.textContent = message;
    }

    async function handleApiRequest(url, method, data) {
        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Error:', error);
            showStatus(`Error: ${error.message}`, true);
            throw error;
        }
    }

    async function loadProjects() {
        try {
            const projects = await handleApiRequest('/api/projects', 'GET');
            projectList.innerHTML = projects.map(project => 
                `<li><button onclick="loadProject('${encodeURIComponent(project)}')">${project}</button></li>`
            ).join('');
        } catch (error) {
            console.error('Error loading projects:', error);
            showStatus('Error loading projects.', true);
        }
    }

    createProjectButton.addEventListener('click', async () => {
        const projectName = projectNameInput.value.trim();
        const script = scriptTextarea.value.trim();

        if (!projectName || !script) {
            showStatus('Please enter both project name and script.', true);
            return;
        }

        try {
            await handleApiRequest('/api/create-project', 'POST', { projectName, script });
            showStatus('Project created successfully');
            await loadProjects();
            projectNameInput.value = '';
            scriptTextarea.value = '';
        } catch (error) {
            showStatus(`Error creating project: ${error.message}`, true);
        }
    });

    generateVideoButton.addEventListener('click', async () => {
        const projectName = projectNameInput.value.trim();
        const scriptPace = parseFloat(scriptPaceInput.value);
        if (!projectName) {
            showStatus('Please load a project first.', true);
            return;
        }

        try {
            updateProgress(0, 'Starting video generation...');
            showStatus('Downloading videos...', false);
            await handleApiRequest('/api/download-videos', 'POST', { projectName: encodeURIComponent(projectName) });
            
            updateProgress(50, 'Videos downloaded. Starting editing process...');
            showStatus('Editing video...', false);
            await handleApiRequest('/api/edit-video', 'POST', { projectName: encodeURIComponent(projectName), scriptPace });
            
            updateProgress(100, 'Video generated successfully');
            showStatus('Video generated successfully');
        } catch (error) {
            showStatus(`Error generating video: ${error.message}`, true);
        }
    });

    window.loadProject = async function(encodedProjectName) {
        try {
            const projectName = decodeURIComponent(encodedProjectName);
            const projectData = await handleApiRequest(`/api/project/${encodedProjectName}`, 'GET');
            projectNameInput.value = projectData.projectName;
            scriptTextarea.value = projectData.script;
            showStatus('Project loaded successfully.');
        } catch (error) {
            console.error('Error loading project:', error);
            showStatus('An error occurred while loading the project.', true);
        }
    };

    loadProjects();
});