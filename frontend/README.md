## Bugs:

## Todo:

- 'book already loaded' alert and logical errors..
- flashcard (make hanja part scrollable and better UI (non hanja should not display that section))

- bookmark that actually covers parts of the page would be cool
- implement keeping track of daily progress section
- implement streaks using the global variable
- add ability to view words when clicking on the level tabs
- flesh out e-reader
- sleeker style

Bugs/Small Todos:
    - check all unnecessary stuff
        - rerenders (progress bar, learn.js, etc.)
        - storage
        - useEffect/useStates
    - find more efficient way to display hanja details for the reading and learning sections

- modal
    - backspace should go to previous modal 🟥
    - if text is flex-wrapped for the modal header definition, it should be positioned at the top as opposed to the middle when it is not wrapped. better visual :) 🟨

- loading indication when translating and dictionary... 🟨
    - when a word is clicked, immeidately show loading (with gif?)
    - cache stuff for less api calls and smoother feel

- user login 🟥

- highlighting sentence when pressed again (why is it so hard!! ahhhh) 🟥
    - **_learned about UI styling :(( Text and View have some specific interactions_**
        - Text inside Text makes it possible to wrap around well and connect
        - Text cannot have background color if it's not merely word inside
        - View has flexwrap, alignself, alignitems, etc.
    - need to figure out how to make it wrap (Text-Text) while also having color within... (which means we can't use Text).. but also (View-Text) doesn't seem to work.. it doesn't wrap properly (new line for each Text)..hmmm
    - consider removing distinction between modes. one press (dictionary), again press (translator) could be better.
    - highlighting sentence when pressed again 🟨

## Done

Learned So Far: PanResponder/Animated | Modal | Context | CORS (server) | Promise (async) | FastAPI

- book doesn't remember page it was on last when new book is selected ✅
    - basic implementation where the location is saved
- when highlighting word not found in dictionary it keeps saying Loading... ✅
    - modal looks cleaner and some bugs fixed

- highglighteed word doesn't go away when book is changed, make it reset under specified conditions ✅
- fixed synchronizing problem using a non-Promise hook from Reader library ✅
    - ended using new useState to keep track of render and useEffect to fetch meta data when re-rendered.
    - nice that the Reader component had a onReady parameter :)

- implemented Epub reader and ability to do everything as before with the text :) yay for compartmentalization ✅

bug fixes: ✅
    - need to reload the learn tab to update progressbar :(
    - font importing is buggy sometimes, it takes time? and it has minor error
    - more cards don't show up when new words are saved sometimes

- progress bar and flashcard swipe action is in sync now ✅

- basic flashcard setup :) stacking Flashcard component works and cool font used ✅
    - hanja information ✅
    - UI and Animation ✅
    - flip and swipe implemented ✅
    - swipe logic behind it (anki, red, yellow, green...) ✅
    - check for hanja character before Hanja Details ✅
    - **_learned how to use PanResponder and Animated for nice animation_**

- HANJA CONNECTION !! make the dictionary top section more detailed ✅
    - currently, the website API is not working.. need to know if it's blocked 
        - nah was just Unicode encoding issue

- check for hanja in origin (it can be english) and make each character clickable ✅
    - modal hanja clickable to keep digging into unknown hanjas ✅
    - modal popup looks sleeek ✅
    - modal popup when hanja is pressed ✅
    - **_learned how to better use the Modal component_**

- papago and google switching properly ✅
- change toggle from switch to sliding touchableopacity ✅
- i don't think it's necessary to call stemming when in translator mode ✅
    - solved by separation of concerns and better file managing :))

- file structure much better and readable. good React practice learned
    - learned an Effect is best used and when not
    - "Thinking in React" tutorial was very useful and still more to learn
- click again to highlight long sentence ✅
- text doesn't wrap properly in sentence mode✅
- can highlight many words at a time... ✅
    - separate from touchopacity thing... or automatically translate entire sentence

- also, rename the global variable cus it's getting used a lot ✅
- toggle between translators buggy (switch doesn't stay in place and moves back when clicked) ✅
- when toggleing between translator and dictionary, reset highlighted word to "" ✅
    - and translated sentence to ""

- made the transNotDict useState hook more global by using Contexts. set up the context and used it according ✅
    - **_learned how to access a single useState variable globally by using Context, Provider, and UseContext :)_**

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
    - **_learned about connecting server and emulator/local machine (e.g. CORS)_**

- save icon should be connected to every word ✅
    - **_learned about importance of asynchrony in database operations (async/await/promise)_**
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
    
- **_set up FastAPI_** (but struggling to connect it with frontend...) ✅
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

- make the definition where the word is equal to the highlightedword to show in topsection before 'more' is pressed.

## Non-MVP Topics

- currently, i'm using OKT library but it's not always accurate... e.g. 사롭잡다 -> 사로자다; 향하기 -> "향", "하다" -> incense... :( ❓
    - 챙겨간 -> 챙기다, 간 (noun) better would be 챙기다, -간 but needs more thought and logic
    - 올라오다 doesn't translate because it doesn't have an english equivalent in dict...
    - I'm assuming that KKMA library can handle this better,, not high priority 🧨

- web scraping and getting news ❓
- home page with list of categories for readings that the user can choose ❓
- loading indication when changing text.. 🟥
- visualization would be fun: google: 'matplotlib data network graph'🟥

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



## Credit:

KoNLPy: very helpful for Korean stemming :))
Eunjeong L. Park, Sungzoon Cho. “KoNLPy: Korean natural language processing in Python”, Proceedings of the 26th Annual Conference on Human & Cognitive Language Technology, Chuncheon, Korea, Oct 2014.