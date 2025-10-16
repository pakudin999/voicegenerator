/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality } from '@google/genai';

// Global state
const API_KEY = 'AIzaSyAXeRxdOd-p1-jDo4jgnUecCyKfID2yPgA';
let ai: GoogleGenAI;
const generatedAssetUrls: {url: string; filename: string}[] = [];

// Helper function to set loading state properly
function setLoadingState(element: HTMLElement, message: string, isRetry = false, retryAttempt?: number) {
  element.classList.remove('loading');
  if (isRetry && retryAttempt) {
    element.innerHTML = `Please Wait... (${retryAttempt})`;
  } else {
    element.innerHTML = message;
  }
  element.classList.add('loading');
}

// DOM Elements
const supportBtn = document.querySelector(
  '#support-btn',
) as HTMLButtonElement;
const generateButton = document.querySelector(
  '#generate-button',
) as HTMLButtonElement;
const resultsContainer = document.querySelector(
  '#results-container',
) as HTMLDivElement;
const placeholder = resultsContainer.querySelector(
  '.placeholder',
) as HTMLDivElement;
const globalStatusEl = document.querySelector(
  '#global-status',
) as HTMLParagraphElement;
const supportSection = document.querySelector(
  '#support-section',
) as HTMLElement;
const closeSupportBtn = document.querySelector(
  '#close-support-btn',
) as HTMLButtonElement;

// Voice Mode Elements
const voiceScriptInput = document.querySelector(
  '#voice-script-input',
) as HTMLTextAreaElement;
const voiceSelect = document.querySelector(
  '#voice-select',
) as HTMLSelectElement;

// Utility Functions
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadFile(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  onRetry: (attempt: number, delay: number) => void,
): Promise<T> {
  let attempt = 1;
  let delayMs = 1000; // Start with 1 second
  const maxDelayMs = 16000; // Max 16 seconds

  while (true) {
    try {
      return await fn();
    } catch (e) {
      console.warn(`Attempt ${attempt} failed. Retrying in ${delayMs}ms...`, e);
      onRetry(attempt, delayMs);
      await delay(delayMs);
      attempt++;
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }
}

// Convert base64 PCM audio to WAV format for browser playback
function createWavHeader(sampleRate: number, numChannels: number, bitsPerSample: number, dataSize: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  
  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF'); // ChunkID
  view.setUint32(4, 36 + dataSize, true); // ChunkSize
  writeString(8, 'WAVE'); // Format
  writeString(12, 'fmt '); // Subchunk1ID
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true); // ByteRate
  view.setUint16(32, numChannels * bitsPerSample / 8, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample
  writeString(36, 'data'); // Subchunk2ID
  view.setUint32(40, dataSize, true); // Subchunk2Size
  
  return buffer;
}

function pcmToWav(base64PCM: string): Blob {
  // Decode base64 to binary
  const binaryString = atob(base64PCM);
  const pcmData = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmData[i] = binaryString.charCodeAt(i);
  }
  
  // Create WAV header (24kHz, 16-bit, mono as per API spec)
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const header = createWavHeader(sampleRate, numChannels, bitsPerSample, pcmData.length);
  
  // Combine header and PCM data
  const wavData = new Uint8Array(header.byteLength + pcmData.length);
  wavData.set(new Uint8Array(header), 0);
  wavData.set(pcmData, header.byteLength);
  
  return new Blob([wavData], { type: 'audio/wav' });
}

// Core Voice TTS Generation Logic  
async function generateTTSAudio(
  text: string,
  voiceName: string,
): Promise<{url: string; filename: string} | null> {
  if (!text) return null;
  if (!ai) {
    throw new Error("AI client not initialized.");
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName,
            },
          },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (audioData) {
      // Convert base64 PCM to WAV format for browser playback
      const wavBlob = pcmToWav(audioData);
      const objectURL = URL.createObjectURL(wavBlob);
      const filename = `voice-${Date.now()}.wav`;
      return {url: objectURL, filename};
    } else {
      console.warn('No audio content found in TTS response:', response);
      throw new Error("The model did not return audio. This might be due to safety filters or an empty response.");
    }
  } catch (error) {
    console.error('Failed to generate TTS audio:', error);

    // Default user-friendly message
    let userFriendlyMessage = 'An unexpected error occurred. Please try again.';

    if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        const errorString = error.toString().toLowerCase();

        if (errorMessage.includes('api key not valid')) {
            userFriendlyMessage = 'The provided API Key is invalid. Please contact the developer.';
            return null;
        } else if (errorMessage.includes('rate limit') || errorString.includes('429')) {
            userFriendlyMessage = "You've made too many requests recently. Please wait a moment before trying again.";
        } else if (errorMessage.includes('invalid argument') || errorString.includes('400')) {
            userFriendlyMessage = "Invalid request. Please check the script for unsupported characters or try a different voice.";
        } else if (errorMessage.includes('server error') || errorString.includes('500') || errorString.includes('503')) {
            userFriendlyMessage = "The AI server is experiencing issues. This is likely temporary. Please try again soon.";
        } else {
            // Use the original error message if it's not one of the caught cases.
            userFriendlyMessage = error.message;
        }
    }
    
    // Throw a new error with the determined user-friendly message.
    throw new Error(userFriendlyMessage);
  }
}

async function generateVoice() {
  const scriptText = voiceScriptInput.value.trim();
  const selectedVoice = voiceSelect.value;
  
  globalStatusEl.textContent = '';
  globalStatusEl.style.color = '';

  if (!scriptText) {
    globalStatusEl.innerText = 'Please enter a script to generate voice.';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';

  // Create result item with processing status first
  const resultItem = document.createElement('div');
  resultItem.className = 'result-item';
  
  const statusEl = document.createElement('p');
  statusEl.className = 'status';
  setLoadingState(statusEl, 'Generating voice');
  resultItem.appendChild(statusEl);
  
  resultsContainer.prepend(resultItem);

  const onRetryCallback = (attempt: number) => {
    setLoadingState(statusEl, '', true, attempt);
  };

  try {
    setLoadingState(statusEl, 'Generating voice');
    const audioData = await retryWithBackoff(
      () => generateTTSAudio(scriptText, selectedVoice),
      onRetryCallback,
    );
    
    if (audioData) {
      // Clear processing status and set up the result
      resultItem.innerHTML = '';
      resultItem.dataset.filename = audioData.filename;

      // Create Delete Button
      const deleteButton = document.createElement('button');
      deleteButton.className = 'delete-button';
      deleteButton.innerHTML = '&times;';
      deleteButton.setAttribute('aria-label', 'Delete audio');
      deleteButton.onclick = () => {
        const filenameToDelete = resultItem.dataset.filename;
        const indexToDelete = generatedAssetUrls.findIndex(
          (v) => v.filename === filenameToDelete,
        );
        if (indexToDelete > -1) {
          generatedAssetUrls.splice(indexToDelete, 1);
        }
        resultItem.remove();

        if (resultsContainer.childElementCount === 1) { // only placeholder is left
          placeholder.style.display = 'flex';
        }
      };

      // Voice info display
      const voiceInfoDisplay = document.createElement('div');
      voiceInfoDisplay.className = 'voice-info';
      voiceInfoDisplay.innerHTML = `
        <div class="voice-details">
          <strong>Voice:</strong> ${selectedVoice}
        </div>
        <div class="script-preview">${scriptText}</div>
      `;

      // Audio container
      const audioContainer = document.createElement('div');
      audioContainer.className = 'audio-container';
      const audioEl = document.createElement('audio');
      audioEl.controls = true;
      audioEl.src = audioData.url;
      audioContainer.appendChild(audioEl);

      // Actions container
      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'card-actions';

      const downloadButton = document.createElement('button');
      downloadButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download Audio`;
      downloadButton.className = 'card-button';
      downloadButton.onclick = () => downloadFile(audioData.url, audioData.filename);

      actionsContainer.appendChild(downloadButton);
      
      resultItem.appendChild(deleteButton);
      resultItem.appendChild(voiceInfoDisplay);
      resultItem.appendChild(audioContainer);
      resultItem.appendChild(actionsContainer);

      generatedAssetUrls.push({url: audioData.url, filename: audioData.filename});
      
    } else {
      statusEl.innerText = 'Failed to generate voice audio. Please try again.';
      statusEl.style.color = '#f472b6';
    }
  } catch (e) {
    statusEl.innerText = `Error: ${e.message}`;
    statusEl.style.color = '#f472b6';
    console.error('Voice generation failed:', e);
  }
}

// Scroll Header Effect
function handleHeaderScroll() {
  const header = document.querySelector('header') as HTMLElement;
  if (window.scrollY > 50) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
}

// Event Listeners Setup
function setupEventListeners() {
  // Support Modal
  closeSupportBtn.addEventListener('click', () => {
    supportSection.classList.add('hidden');
  });

  supportSection.addEventListener('click', (e) => {
    // Closes the modal if the click is on the background overlay
    if (e.target === supportSection) {
      supportSection.classList.add('hidden');
    }
  });

  supportBtn.addEventListener('click', () => {
    window.open('https://www.tiktok.com/@konten_beban', '_blank');
  });
  
  // Main generate button
  generateButton.addEventListener('click', generateVoice);
}

// App Initialization
function initializeApp() {
  setupEventListeners();
  window.addEventListener('scroll', handleHeaderScroll);
  
  try {
    ai = new GoogleGenAI({ apiKey: API_KEY });
    generateButton.disabled = false;
    globalStatusEl.textContent = 'Ready to generate.';
    globalStatusEl.style.color = 'var(--accent-primary)';
  } catch (e) {
    console.error("Failed to initialize GoogleGenAI:", e);
    generateButton.disabled = true;
    globalStatusEl.textContent = 'Error: API Key is not valid.';
    globalStatusEl.style.color = '#f472b6';
  }
}

initializeApp();