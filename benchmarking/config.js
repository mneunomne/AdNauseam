import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  // Path to ungoogled Chromium executable
  executablePath: '/Applications/Chromium.app/Contents/MacOS/Chromium',

  // Persistent browser profile directory (accumulates history/cookies across runs)
  profileDir: path.resolve(__dirname, 'profiles/default'),

  // Path to built AdNauseam extension (dev build with production=0)
  extensionPath: path.resolve(__dirname, '../dist/build/adnauseam.chromium'),

  // Browser window settings
  viewport: { width: 1920, height: 1080 },

  // Session configuration
  session: {
    // Duration in minutes
    duration: 10,
    // Default scenario: 'news', 'mixed', 'custom'
    scenario: 'mixed',
  },

  // Human behavior tuning
  behavior: {
    // Time spent on each page (seconds) - gaussian around these values
    dwellTime: { min: 8, max: 40, mean: 15 },
    // Pause between page navigations (seconds)
    betweenPages: { min: 1, max: 4 },
    // How many internal links to click per page
    subPageClicks: { min: 1, max: 2 },
    // Probability of using back button instead of clicking a new link
    backButtonProbability: 0.2,
    // Scroll speed (pixels per scroll step)
    scrollStep: { min: 200, max: 600 },
    // Pause during scrolling (ms)
    scrollPause: { min: 300, max: 1000 },
    // Typing speed per character (ms)
    typingDelay: { min: 30, max: 120 },
  },

  // Data extraction interval (seconds) - how often to poll AdNauseam state
  extractionInterval: 15,

  // Results output directory
  resultsDir: path.resolve(__dirname, 'results'),

  // Custom URLs file
  customUrlsFile: path.resolve(__dirname, 'urls/custom.json'),

  // URL lists for scenarios
  urls: {
    news: [
      'https://www.nytimes.com',
      'https://www.cnn.com',
      'https://www.bbc.com/news',
      'https://www.theguardian.com',
      'https://www.reuters.com',
      'https://www.washingtonpost.com',
      'https://arstechnica.com',
      'https://www.wired.com',
    ],
    mixed: [
      'https://www.google.com',
      'https://www.nytimes.com',
      'https://www.reddit.com',
      'https://www.cnn.com',
      'https://www.google.com',
      'https://duckduckgo.com',
      'https://www.wikipedia.org',
      'https://www.bbc.com/news',
      'https://weather.com',
      'https://www.youtube.com',
      'https://www.amazon.com',
      'https://www.theguardian.com',
      'https://www.google.com',
    ],
    search: [
      'https://www.google.com',
      'https://www.google.com',
      'https://duckduckgo.com',
      'https://www.bing.com',
    ],
  },

  // Search queries for mixed/search scenarios (buying intent triggers more ads)
  searchQueries: [
    'buy laptop online',
    'best deals on headphones',
    'cheap flights to europe',
    'car insurance quotes',
    'buy iphone 16 pro',
    'best mattress 2026',
    'cheap hotels new york',
    'buy running shoes nike',
    'best credit card rewards',
    'home insurance comparison',
    'buy sofa online free delivery',
    'vpn subscription deals',
    'web hosting plans',
    'buy coffee machine',
    'best protein powder',
    'cheap flights to tokyo',
    'buy used car near me',
    'best running shoes 2026',
    'healthy dinner recipes',
    'how to learn guitar',
  ],
};

export default config;
