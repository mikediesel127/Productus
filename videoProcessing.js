const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

const pexelsApiKey = process.env.PEXELS_API_KEY;

// Update createProject function
async function createProject(projectData) {
  const { script, projectName } = projectData;
  
  if (!script || !projectName) {
    throw new Error('Script and project name are required');
  }
  
  const projectFolder = path.join(__dirname, 'downloads', projectName);
  try {
    await fsPromises.mkdir(projectFolder, { recursive: true });
    
    const scriptPath = path.join(projectFolder, 'script.txt');
    await fsPromises.writeFile(scriptPath, script);

    console.log('Project created:', projectFolder);
    return { message: 'Project created', projectName };
  } catch (error) {
    console.error('Error in createProject:', error);
    throw error;
  }
}

// Update downloadVideos function
async function downloadVideos(projectName, openai) {
  const projectFolder = path.join(__dirname, 'downloads', projectName);
  const scriptPath = path.join(projectFolder, 'script.txt');
  
  try {
    await fsPromises.access(scriptPath);
    const script = await fsPromises.readFile(scriptPath, 'utf-8');
    const topics = await analyzeScriptWithGPT(script, openai);
    await downloadMedia(projectFolder, topics, script);
    return { message: 'Videos downloaded successfully' };
  } catch (error) {
    console.error(`Error downloading videos for project ${projectName}:`, error);
    throw new Error(`Failed to download videos: ${error.message}`);
  }
}

// Update analyzeScriptWithGPT function
async function analyzeScriptWithGPT(script, openai) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant that analyzes scripts and provides search terms for relevant stock footage and images." },
        { role: "user", content: `Analyze this script and provide a list of 5-10 specific search terms for relevant stock footage and images. Focus on key visual elements, scenes, and concepts that would make good video clips. Prioritize terms that would yield good video results. Avoid using special characters or punctuation in the search terms:\n\n${script}\n\nRespond only with the list of search terms, one per line.` }
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    return response.choices[0].message.content.trim().split('\n');
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    throw error;
  }
}

// Update downloadMedia function
async function downloadMedia(projectFolder, topics, script) {
  const videoDuration = estimateVideoDuration(script);
  let totalDuration = 0;
  let videoIndex = 1;

  for (const topic of topics) {
    if (totalDuration >= videoDuration) break;

    const sanitizedTopic = topic.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const videoPath = path.join(projectFolder, `${videoIndex.toString().padStart(2, '0')}_${sanitizedTopic}.mp4`);
    
    try {
      await downloadVideo(topic, videoPath);
      const duration = await getVideoDuration(videoPath);
      totalDuration += duration;
      videoIndex++;
    } catch (error) {
      console.error(`Error downloading video for topic "${topic}":`, error);
      // Continue with the next topic if one fails
    }
  }
}

// Update downloadVideo function
async function downloadVideo(query, outputPath) {
  try {
    const response = await axios.get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15`, {
      headers: { Authorization: pexelsApiKey }
    });

    if (response.data.videos.length > 0) {
      const randomIndex = Math.floor(Math.random() * Math.min(response.data.videos.length, 15));
      const video = response.data.videos[randomIndex];
      const videoFile = video.video_files.find(file => file.quality === 'hd' && file.width >= 1280) || 
                        video.video_files.find(file => file.quality === 'sd' && file.width >= 640) ||
                        video.video_files[0];
      
      if (videoFile) {
        const videoResponse = await axios.get(videoFile.link, { responseType: 'stream' });
        const writer = fs.createWriteStream(outputPath);
        videoResponse.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        const stats = await fsPromises.stat(outputPath);
        if (stats.size === 0) {
          throw new Error('Downloaded video file is empty');
        }
      } else {
        throw new Error('No suitable video file found');
      }
    } else {
      throw new Error(`No video found for query: ${query}`);
    }
  } catch (error) {
    console.error(`Error downloading video for query "${query}":`, error);
    throw error;
  }
}

// Update editVideo function
async function editVideo(projectName, scriptPace = 1) {
  const projectFolder = path.join(__dirname, 'downloads', projectName);
  const outputPath = path.join(projectFolder, `${projectName.replace(/\s+/g, '_')}_final.mp4`);
  const scriptPath = path.join(projectFolder, 'script.txt');

  try {
    await fsPromises.access(projectFolder);
    const script = await fsPromises.readFile(scriptPath, 'utf-8');
    const sentences = script.split(/[.!?]+/).filter(Boolean);
    const files = await fsPromises.readdir(projectFolder);
    const videoFiles = files.filter(file => file.endsWith('.mp4') && !file.includes('_final'))
                           .sort((a, b) => {
                             const aNum = parseInt(a.split('_')[0]);
                             const bNum = parseInt(b.split('_')[0]);
                             return aNum - bNum;
                           });

    if (videoFiles.length === 0) {
      throw new Error('No video files found in the project folder');
    }

    const filter_complex = [];
    const inputs = [];
    let outputIndex = 0;

    const averageWordsPerMinute = 150;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const wordCount = sentence.split(' ').length;
      const duration = (wordCount / averageWordsPerMinute) * 60 * scriptPace;
      const videoFile = videoFiles[i % videoFiles.length];
      inputs.push(`-i "${path.join(projectFolder, videoFile)}"`);
      
      filter_complex.push(`[${outputIndex}:v]trim=duration=${duration},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v${outputIndex}]`);
      outputIndex++;
    }

    const concatFilters = Array.from({length: outputIndex}, (_, i) => `[v${i}]`).join('');
    filter_complex.push(`${concatFilters}concat=n=${outputIndex}:v=1:a=0[outv]`);

    const ffmpegArgs = [
      '-y',  // This option tells FFmpeg to overwrite the output file without asking
      ...inputs,
      '-filter_complex', filter_complex.join(';'),
      '-map', '[outv]',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      outputPath
    ];

    console.log('FFmpeg command:', ffmpegArgs.join(' '));

    await new Promise((resolve, reject) => {
      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { shell: true });

      ffmpegProcess.stderr.on('data', (data) => {
        console.error(`FFmpeg stderr: ${data}`);
      });

      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          console.log('Video editing completed successfully');
          resolve();
        } else {
          reject(new Error(`FFmpeg process exited with code ${code}`));
        }
      });

      ffmpegProcess.on('error', (error) => {
        console.error('FFmpeg process error:', error);
        reject(error);
      });
    });

    return { message: 'Video edited successfully' };
  } catch (error) {
    console.error('Error in editVideo function:', error);
    throw error;
  }
}

// Update getVideoDuration function
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('Error in ffprobe:', err);
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}


function estimateVideoDuration(script) {
  const wordCount = script.split(/\s+/).length;
  return (wordCount / 150) * 60;
}



// New helper function: parseFFmpegProgress
function parseFFmpegProgress(output) {
  const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})/);
  if (timeMatch) {
    const [, hours, minutes, seconds] = timeMatch;
    const totalSeconds = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
    const totalDuration = calculateTotalDuration(sentences, scriptPace);
    return Math.min(Math.round((totalSeconds / totalDuration) * 100), 100);
  }
  return null;
}

// New helper function: calculateTotalDuration
function calculateTotalDuration(sentences, scriptPace) {
  return sentences.reduce((total, sentence) => {
    const wordCount = sentence.split(' ').length;
    return total + (wordCount / 150) * 60 * scriptPace;
  }, 0);
}

async function getProjects() {
  const downloadsPath = path.join(__dirname, 'downloads');
  try {
    await fsPromises.access(downloadsPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fsPromises.mkdir(downloadsPath);
    } else {
      throw error;
    }
  }
  const projects = await fsPromises.readdir(downloadsPath, { withFileTypes: true });
  return projects
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

async function getProject(projectName) {
  const projectFolder = path.join(__dirname, 'downloads', projectName);
  const scriptPath = path.join(projectFolder, 'script.txt');
  try {
    await fsPromises.access(scriptPath);
    const script = await fsPromises.readFile(scriptPath, 'utf-8');
    return { projectName, script };
  } catch (error) {
    console.error(`Error accessing project ${projectName}:`, error);
    throw new Error('Project not found');
  }
}

async function downloadFinalVideo(projectName, res) {
  const videoPath = path.join(__dirname, 'downloads', projectName, `${projectName.replace(/\s+/g, '_')}_final.mp4`);
  
  try {
    await fsPromises.access(videoPath);
    const stats = await fsPromises.stat(videoPath);
    
    if (stats.size === 0) {
      res.status(404).json({ message: 'Video file is empty' });
    } else {
      res.download(videoPath);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ message: 'Video not found' });
    } else {
      console.error('Error accessing video file:', error);
      res.status(500).json({ message: 'An error occurred while accessing the video file' });
    }
  }
}

module.exports = {
  createProject,
  downloadVideos,
  editVideo,
  getProjects,
  getProject,
  downloadFinalVideo
};
