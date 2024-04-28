#### To-do..
 
## Todo:

- can highlight many words at a time... 🟨
    - separate from touchopacity thing... or automatically translate entire sentence
    - click again to highlight long sentence
    - the current solution is problematic, the text doesn't wrap and seems clunky

- check for hanja in origin (it can be english) and make each character clickable 🟨 
- modal popup when hanja is pressed
- HANJA CONNECTION !! make the dictionary top section more detailed 🟥
    - locate hanja if existing
    // can be multiple hanjas
    // show only most common
    // ... hanja definition API?? 
    - show origin and POS and don't show repeats..
    - visualization would be fun: google: 'matplotlib data network graph'

- loading indication when translating and dictionary... 🟨
    - when a word is clicked, immeidately show loading (with gif?)
    - cache stuff for less api calls and smoother feel

- user login 🟥

- flashcard section ... 🟥

## Done

- made the transNotDict useState hook more global by using Contexts. set up the context and used it according ✅
    - learned how to access a single useState variable globally by using Context, Provider, and UseContext :)

- expand top section? when viewing connections, extensive def... ✅
    - should show other defs from the korean dictionary api if there is more space?
- can only save words when in dictionary mode ✅
    - save icon next to words from dictionary
    - how will saving and definition work? save each word's def and origin :)

- created separate file for the bottom section of 'read' page ✅ 

- add 'more' that expands and only show the first result initially ✅ 
    - implemented a way to expand and compress definition, only show the first definition (naive approach)

- display word, origin, and definition ✅ 
- add option between google and papago translate :) ✅ 

- see if https://github.com/KoreanThinker/react-native-translator actually was a fast translator...
    - it's alright ✅ 

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

- make the definition where the word is equal to the highlightedword to show in topsection before 'more' is pressed.
- currently, i'm using OKT library but it's not always accurate... e.g. 사롭잡다 -> 사로자다; 향하기 -> "향", "하다" -> incense... :( ❓
    - 챙겨간 -> 챙기다, 간 (noun) better would be 챙기다, -간 but needs more thought and logic
    - 올라오다 doesn't translate because it doesn't have an english equivalent in dict...
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