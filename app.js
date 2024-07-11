require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require("openai");
const videoProcessing = require('./videoProcessing');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


app.post('/api/create-project', async (req, res) => {
  try {
    const result = await videoProcessing.createProject(req.body);
    res.json(result);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ message: 'An error occurred while creating the project', error: error.message });
  }
});

app.post('/api/download-videos', async (req, res) => {
  try {
    const projectName = decodeURIComponent(req.body.projectName);
    const result = await videoProcessing.downloadVideos(projectName, openai);
    res.json(result);
  } catch (error) {
    console.error('Error downloading videos:', error);
    res.status(500).json({ message: 'An error occurred while downloading videos', error: error.message });
  }
});

app.post('/api/edit-video', async (req, res) => {
  try {
    const projectName = decodeURIComponent(req.body.projectName);
    const scriptPace = req.body.scriptPace;
    const result = await videoProcessing.editVideo(projectName, scriptPace);
    res.json(result);
  } catch (error) {
    console.error('Error editing video:', error);
    res.status(500).json({ message: 'An error occurred while editing the video', error: error.message });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    const projectList = await videoProcessing.getProjects();
    res.json(projectList);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ message: 'An error occurred while fetching projects' });
  }
});

app.get('/api/project/:projectName', async (req, res) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName);
    const projectData = await videoProcessing.getProject(projectName);
    res.json(projectData);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(404).json({ message: 'Project not found' });
  }
});

app.get('/api/download-video/:projectName', async (req, res) => {
  try {
    const projectName = decodeURIComponent(req.params.projectName);
    await videoProcessing.downloadFinalVideo(projectName, res);
  } catch (error) {
    console.error('Error downloading video:', error);
    res.status(500).json({ message: 'An error occurred while downloading the video' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));