<div align="center">

<img src="frontend/assets/icon.png" alt="Noeul" width="96" height="96" />

# Noeul

**Read real books in your target language — with a dictionary, translator, and memory built in.**

Reading is the fastest way to acquire a language. Noeul removes the friction that normally makes foreign-language reading exhausting: instant word lookups, sentence translation, character-root exploration, and spaced-repetition flashcards — all without leaving the page.

[![Website](https://img.shields.io/badge/Website-noeul.app-2d6cdf?logo=safari&logoColor=white)](https://noeul.app/)
&nbsp;
[![Download APK](https://img.shields.io/badge/Download-Android_APK-3ddc84?logo=android&logoColor=white)](https://github.com/changah-song/noeul/releases/latest)
&nbsp;
![Google Play — Coming Soon](https://img.shields.io/badge/Google_Play-Coming_Soon-414141?logo=google-play&logoColor=white)
&nbsp;
![Built with Expo](https://img.shields.io/badge/built_with-React_Native%20%2F%20Expo-000020?logo=expo&logoColor=white)

See it in action at **[noeul.app](https://noeul.app/)**.

</div>

---

## Download

**Android:** grab the latest APK from the **[Releases page](https://github.com/changah-song/noeul/releases/latest)** and install it on your phone.

1. Download `noeul-vX.Y.Z.apk` from the newest release.
2. Open it — Android will warn about "install from unknown sources"; tap **Settings → Allow from this source**, then **Install**. (Normal for any app not from the Play Store.)
3. Requires **Android 6.0+** and Google Play Services (for sign-in).

**Google Play:** coming soon.
**iOS:** not yet available.

---

## What is Noeul?

Noeul is a mobile reading app for people learning a language by **reading real books — not doing drills.** You load a novel (your own file or one from a built-in public-domain library), read it in the target language, and tap any word or sentence to understand it in place.

It's built for **self-studying learners** who are intrinsically motivated and read in quiet moments — the commute, the evening wind-down, the weekend study session. The design goal is a *well-lit study room*: calm, focused, literary. The text gets the screen; everything else gets out of the way.

- **Primary target language:** Korean (deepest dictionary, Hanja, and leveling support). The architecture also supports **English** and **Chinese**.
- **Interface available in 11 languages:** English, Korean, Chinese, French, Spanish, Arabic, Mongolian, Vietnamese, Thai, Indonesian, Russian.
- **Offline-first:** your books, saved words, and progress live on-device; optional cloud sync when you sign in.

---

## Features

### A distraction-free reader
Import your own **EPUB / PDF**, or download from a curated **public-domain library**. Tap a word for an instant dictionary lookup; highlight a phrase for sentence translation. Paged or vertical-scroll reading, focus mode, table of contents, bookmarks, per-book notes, adjustable typography, and pronunciation audio.

### Deep linguistic lookups
Every Korean/Chinese word decomposes into its **root characters** (Hanja / Hànzì) — each with meaning, reading, related words, and derived forms. One lookup becomes a small web of connected vocabulary.

### In-context AI meaning
A dictionary gives the *generic* meaning. Tap **Meaning** and Noeul sends the word plus its sentence to an AI model that explains what the word means *in this specific context* — including figurative and literary uses a dictionary would miss. Works for out-of-vocabulary and archaic words too, and you can save the result.

### Personalized spaced repetition
Saved words become a flashcard deck scheduled with an **FSRS** spaced-repetition model. Uniquely, each new card is *seeded from an estimate of how likely you already know the word* — so Noeul doesn't waste your time re-drilling words you clearly know, and front-loads the ones you don't.

### A personalization engine
Noeul models your ability as a single number on the same scale as each word's difficulty (an IRT/Rasch approach). It updates continuously as you read, look words up, take a **calibration quiz**, and review — powering **word suggestions**, per-book **reading-ease** estimates, and flashcard seeding. Books literally get easier on your shelf as you improve.

### AI writing practice
Write in your target language and get **categorized, inline feedback** — grammar, word choice, naturalness, and translations for words you fell back to in your native language. Those gaps become your highest-signal words to learn next.

### Screenshot OCR
Point Noeul at an image of text — a webpage, a sign, a message — and it recognizes the words, overlays tappable regions, and runs the full dictionary / root / AI pipeline on anything you tap.

### Songs
A lighter reading surface for lyrics, poems, and short texts, with the same lookup tools — good for a quick session when a whole chapter is too much.

---

## Tech stack

| Layer | Stack |
|---|---|
| **Mobile app** | React Native · Expo · TypeScript |
| **Backend** | Python (FastAPI) · translation + AI orchestration |
| **Data & sync** | Supabase (Postgres, auth, storage) · on-device SQLite |
| **AI** | Claude (in-context word meaning + writing assessment) |
| **Language data** | KRDICT (Korean), CEFR / HSK / NIKL graded vocabulary, Hanja mappings |
| **Personalization** | IRT/Rasch ability model + FSRS spaced repetition, scored on-device |

---

## Contact

Questions, comments, or suggestions welcome — reach me at **noeul.app@gmail.com**.