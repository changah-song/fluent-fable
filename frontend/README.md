#### To-do..

## Todo:

- how will saving and definition work?
    - easiest is to save the list of definitions
- HANJA CONNECTION !! make the dictionary top section more detailed 
    - show origin and POS and don't show repeats..
- see if https://github.com/KoreanThinker/react-native-translator actually was a fast translator...
- loading indication when translating...
    - when a word is clicked, immeidately show loading (with gif?)
    - cache stuff for less api calls and smoother feel
- user login
- flashcard section ...

## Done
- list all definitions from a list of words in dictionary section ✅

- connected local fastapi server to frontend localhost (10.2.2.1 for android emulator) ✅
    - learned about connecting server and emulator/local machine (e.g. CORS)

- save icon should be connected to every word ✅
    - learned about importance of asynchrony in database operations (async/await/promise)  
- delete entries from database ✅
    
- KONLPY!! IMPLEMENT IT :) ✅
    - remove korean particles from highlights (~하다, ~을/를, etc.) 
    - ... if initial highlight isn't a word,, maybe reduce by one character repeatedly until a word is found... 
        - no need? if i just dispaly all words
- no repeating words ✅
     - a smart app would recognize that certain words are the same (verb, noun, etc.)
- save icon should be connected to every word ✅
- delete entries from database ✅

- option to save word... ✅
- separate topsection from lightuptext, give it its own file and see if useEffect can work for the data ✅
- use better translator API ✅
- add toggle for naver dictionary and google translate ✅

- touch onPress isn't as reactive as desired... ✅
    - maybe change it to a touchableopacity ✅
    
- set up FastAPI but struggling to connect it with frontend... ✅
- figured out the KONLPY module and picked the best options (okt > kkma > ...) ✅

- set up database using expo sqlite and adding and viewing data entries ✅

- fixed blank space being highlighted at start ✅
- hid all API keys (env) ✅
- got the toggle between dictionary and translate running successfully ✅
- looked into alternatives for google translate API (with limited calls) ✅
- implemented Korean Dictionary API (unlimited calls, pretty fast) ✅
- the top view now displays the dictionary look-up ✅

- created a better way to view and interact with text. ✅
    - top section for translation
    - accurate highlighting for each word
- rudimentary translator API that is very slow ✅

## Non-MVP Topics

- currently, i'm using OKT library but it's not always accurate... e.g. 사롭잡다 -> 사로자다; 향하기 -> "향", "하다" -> incense... :( ❓
    - 챙겨간 -> 챙기다, 간 (noun) better would be 챙기다, -간 but needs more thought and logic
    - I'm assuming that KKMA library can handle this better,, not high priority 🧨
- web scraping and getting news ❓
- home page with list of categories for readings that the user can choose ❓


--------

PAST IDEA FOR AI PROMPTS

Language selection
Reload chatGPT prompt
Generating prompt based on skill-level (and topic?)
imagery & narration-style, news & news-style
OR MAYBE each unknown word should show up in various contexts throughout the week
cascading feel. once marked unsure, it pops up everyday for a week(?)
categories: business entertainment health science sports technology

Create prompts without words already known by user
Anki curve
Import PDF/EPUD/MOBI (! much more work to implement)
Other ideas

After five words are learned, create paragraph using those words and save. Suggest them to check it with native speaker (reddit, friends, etc.)