To-do..

04/07/2024
- fixed blank space being highlighted at start
- hid all API keys
- got the toggle between dictionary and translate running successfully
- looked into alternatives for google translate API (with limited calls)
- implemented Korean Dictionary API (unlimited calls, pretty fast)
- the top view now displays the dictionary look-up

04/06/2024
- created a better way to view and interact with text.
    - top section for translation
    - accurate highlighting for each word
- rudimentary translator API that is very slow

todo:
READING SCREEN
- loading indication when translating...
- remove korean particles from highlights (~하다, ~을/를, etc.)
- use better translator API ✅
    - find better alternative
- web scraping and getting news
- home page with list of categories for readings that the user can choose
- add toggle for naver dictionary and google translate ✅

USER LOGIN
- google account first

FLASHCARD SCREEN
- create more extensive database layout...

-----

MVP
- Database (expo sql) // done
- Flashcard (colorfy)

Less Priority
- Naver dictionary API
- Language selection
- Reload chatGPT prompt
- Generating prompt based on skill-level (and topic?)
    - imagery & narration-style, news & news-style
- OR MAYBE each unknown word should show up in various contexts throughout the week
    - cascading feel. once marked unsure, it pops up everyday for a week(?)

categories: business entertainment health science sports technology
API key for Korean news: 7f6c3d9ca2c54b09a98bc0e12661b644

Less less Priority
- Create prompts without words already known by user
- Anki curve
- Import PDF/EPUD/MOBI (! much more work to implement)

Other ideas
- After five words are learned, create paragraph using those words and save. Suggest them to check it with native speaker (reddit, friends, etc.)