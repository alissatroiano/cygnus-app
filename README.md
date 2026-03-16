# Cygnus

Cygnus is a travel advisor AI agent created to inform travelers of passport validity rules before they proceed to book an international flight. Cygnus acts as a 'UI Navigator', as it monitors a user's browser and informs them that international countries have different passport validity rules and requirements, and they might not be allowed to check in due to factors including: their passport's expiration date, how many stamps they currently have, and more. Cygnus gives travelers the opportunity to address these issues by directing them to [travel.state.gov](https://travel.state.gov/en/international-travel.html). If the user allows Cygnus to take over, Cygnus will navigate to [travel.state.gov](https://travel.state.gov/en/international-travel.html) and select the user's destination country for them, then scroll to the section the user is concerned about.
 
Cygnus solves a very real world problem, which is that many missed flights caused by passport issues happen because travelers are unaware of passport validity rules, which vary by country. Nearly 40% of travelers are unaware that passport requirements vary by destination. Because of this, a lot of people book flights and get denied at check-in or customs because of their passport's expiration date or because they have too many stamps.

Specific industry-wide statistics for passenger-initiated cancellations solely due to expired or invalid passports are not publicly tracked or published. However, such errors are common causes for boarding denials because many countries require passports to be valid for at least six months beyond travel dates, according to the U.S. Department of State. [source](https://www.google.com/search?sca_esv=5176837d497f6a28&rlz=1C1GEWG_enUS1158US1158&sxsrf=ANbL-n7Wzc2--Cw3k4LyAfGe9RWzCSDN0g:1773449329252&q=passenger+canceled+flight+due+to+passport+expiration+date+statistics&sa=X&ved=2ahUKEwivhLDKlZ6TAxVOmokEHRfMJKMQ7xYoAHoECBoQAQ&biw=1054&bih=730&dpr=1.25#:~:text=AI%20Overview-,Specific%20industry%2Dwide%20statistics%20for%20passenger%2Dinitiated%20cancellations%20solely%20due%20to,U.S.%20Department%20of%20State%20(.gov),-Impact%3A%20Failure). 

Airlines often catch these errors during check-in, preventing passengers from reaching the gate with improper documentation [source](https://travel.state.gov/content/travel/en/passports/passport-help/faqs.html), but that doesn't mean the passenger is guaranteed a refund for the international flight and trip they most likely paid a significant amount for in advance. 

## Getting Started

### Prerequisites

- Python 3.9+
- Node.js and npm
- [Google Gemini API Key](https://aistudio.google.com/app/apikey)

### Setup

1. Clone the repository.
2. Create a `.env` file in the root directory and add your API key:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```
3. Install dependencies:
   - Backend: `pip install -r requirements.txt`
   - Frontend: `cd frontend && npm install`

### Running the Project

The easiest way to run both the backend and frontend is using the master script:

1. **One-Click Start**: Run `run_all.bat` from the root directory. This will open two terminal windows for you.

Alternatively, you can start them manually:

- **Backend**: Execute `run_backend.bat` in the root directory.
- **Frontend**: Navigate to the `frontend` folder and run `npm start`.
- **Standalone AI Studio Script**: Run `python ai_studio_code.py` from the root directory.

## ☸️ Testing Instructions

To test the **Cygnus UI Navigator**, follow these steps:

### 1. Initial Connection
1. Launch the app using `run_all.bat`.
2. Click **"Start Monitoring"** in the web dashboard.
3. Select the **Window** or **Tab** where you will perform your flight search when prompted for screen sharing.
4. Verify the **Digital HUD & Scanning Laser** appears over your stream.

### 2. Autonomous Flight Detection
1. Open a new tab and go to [Google Flights](https://www.google.com/flights).
2. Search for an international destination (e.g., **"Flights to Tokyo"**).
3. **Observe**: Cygnus detects the destination and triggers the **Requirement Alert Popover**.

### 3. Visual UI Interaction
1. Use the **Manual Intent** box: Type *"Find the search button"*.
2. **Observe**: A **Virtual Cursor** moves on the HUD to the exact pixel coordinates of the button.

### 4. Real-time Search
1. Ask: *"What are the entry requirements for Japan in 2026?"*
2. **Observe**: Cygnus uses **Google Search** to fetch live travel data.

## 🛠️ How it Works

Cygnus is built as a **Multimodal UI Navigator**:
- **Vision**: Uses Gemini 2.0 Flash to process real-time screenshots at 1fps.
- **Visual Grounding**: Instead of relying on DOM/HTML, it calculates **normalized coordinates (0-100)** to perform clicks and actions based on raw pixels.
- **Search**: Integrates **Google Search Retrieval** for live, accurate travel advisories.
- **HUD**: A custom React-based Head-Up Display provides visual feedback of the agent's thought stream and calculated cursor positions.


## ☸️ What it does

Cygnus is a **Unified UI Navigator** that leverages Gemini's multimodal capabilities to act as a real-time, hands-free travel companion. It transforms a standard browser into an intelligent, vision-aware environment.

### 🧠 Gemini Multimodal Breakdown

1.  **Vision-First Contextual Awareness**:
    Cygnus captures a real-time stream of the user's screen (1 frame per second). Using **Gemini 2.0 Flash**, it performs continuous visual analysis to identify international destinations, airline logos, and booking widgets. Unlike traditional agents that crawl the DOM, Cygnus "sees" the page exactly as the user does, allowing it to work on any website without custom scrapers.

2.  **Real-time Multimodal Dialogue**:
    The agent maintains a low-latency WebSocket connection with Gemini Live. It combines **Video Input** (screen sharing) with **Audio Input** (user voice) to understand complex intents. If a user says *"Check that country's rules"* while looking at a flight to Japan, Gemini uses its visual context to resolve "that country" to Japan.

3.  **Visual Grounding & Actionable Intelligence**:
    When an international flight is detected, Gemini autonomously triggers the **Requirement HUD**. If the user asks for help navigating, Cygnus calculates **Normalized Visual Coordinates**. It translates its "biological-like" visual understanding of where a button is into precise $(x, y)$ coordinates for the virtual cursor.

4.  **Integrated Search Retrieval**:
    By combining vision with **Google Search Retrieval**, Cygnus doesn't just guess requirements—it fact-checks entry rules in real-time, ensuring users know about the "6-month passport rule" or visa mandates before they reach the payment screen.


## How we built it



## Challenges we ran into



## Accomplishments that we're proud of

## What we learned

## 🚀 What's next for Cygnus

- **Cross-App Workflows**: Moving beyond the browser to navigate desktop applications.
- **Automated Document Scanning**: Visually checking a user's physical passport via webcam to compare against destination requirements.
- **Mobile Navigator**: Bringing the UI Navigator to mobile devices for on-the-go travel assistance.
