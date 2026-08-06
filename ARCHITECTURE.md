# Architecture

Noeul is an offline-first language-learning reading app. The client and a
native EPUB/OCR layer run entirely on-device; a FastAPI service handles NLP
and AI; Supabase provides auth and cloud sync; and an LLM + ML pipeline powers
contextual definitions, writing feedback, and personalized difficulty.

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontFamily':'ui-sans-serif, system-ui','primaryColor':'#eef2ff','primaryBorderColor':'#4f46e5','primaryTextColor':'#1e1b4b','lineColor':'#94a3b8','clusterBkg':'#f8fafc','clusterBorder':'#cbd5e1'}}}%%
flowchart TD
    subgraph CLIENT["📱 &nbsp;CLIENT&nbsp;·&nbsp;React Native / Expo"]
        direction LR
        UI["Screens<br/><sub>Home · Read · Write</sub>"]
        STATE["State & Contexts<br/><sub>app state · i18n (12 locales)</sub>"]
        LOCAL[("On-device SQLite<br/><sub>fluentfable.db · offline-first</sub>")]
    end

    subgraph NATIVE["⚙️ &nbsp;NATIVE LAYER&nbsp;·&nbsp;Expo Modules (Kotlin)"]
        direction LR
        EPUB["Native EPUB Reader<br/><sub>continuous scroll · pagination</sub>"]
        OCR["Screen OCR + Overlay<br/><sub>tap-to-define anywhere</sub>"]
        DICTS[("Bundled Dictionaries<br/><sub>ko / en / zh .db</sub>")]
    end

    subgraph API["🚀 &nbsp;API LAYER&nbsp;·&nbsp;FastAPI on Docker"]
        direction TB
        GUARD{{"Auth Guard<br/><sub>verify Supabase JWT · JWKS</sub>"}}
        NLP["NLP Engines<br/><sub>KoNLPy·Okt · Kiwi · spaCy · jieba</sub>"]
        LANG["Language Endpoints<br/><sub>morphs · romanize · translate · preprocess</sub>"]
        AIEP["AI Endpoints<br/><sub>explain-in-context · writing assessment</sub>"]
    end

    subgraph DATA["🗄️ &nbsp;DATA & AUTH&nbsp;·&nbsp;Supabase"]
        direction LR
        AUTH["Auth<br/><sub>JWT / JWKS</sub>"]
        PG[("Postgres + RPC<br/><sub>profiles · synced user data</sub>")]
    end

    subgraph ML["🧠 &nbsp;LLM / ML PIPELINE"]
        direction LR
        CLAUDE["Anthropic Claude<br/><sub>contextual glosses · writing feedback</sub>"]
        PKNOWN["P(known) Model<br/><sub>scikit-learn · personalized difficulty</sub>"]
        TRAIN["Training Pipeline<br/><sub>train / validate · versioned artifacts</sub>"]
    end

    UI --> STATE --> LOCAL
    STATE --> EPUB
    STATE --> OCR
    EPUB --> DICTS
    OCR --> DICTS

    NATIVE -->|"HTTPS + Bearer JWT"| GUARD
    LOCAL -.->|"background cloud sync"| PG

    GUARD --> LANG
    GUARD --> AIEP
    LANG --- NLP

    GUARD -.->|"validate token"| AUTH

    AIEP -->|"prompt / completion"| CLAUDE
    LANG -->|"feature vector"| PKNOWN
    TRAIN -->|"deploys model artifact"| PKNOWN

    classDef store fill:#fefce8,stroke:#ca8a04,color:#713f12;
    class LOCAL,DICTS,PG store;
```

## Layers

| Layer | Stack | Responsibility |
|-------|-------|----------------|
| **Client** | React Native / Expo | Reading, writing, and study UI; local SQLite as the source of truth; 12-locale i18n. |
| **Native** | Expo Modules (Kotlin) | High-performance native EPUB rendering and on-screen OCR with a tap-to-define overlay; bundled offline dictionaries for zero-latency, no-network lookups. |
| **API** | FastAPI · Docker | JWT-guarded endpoints for morphological analysis, romanization, translation, chapter preprocessing, dictionary search, and AI features. Runs KoNLPy/Okt, Kiwi, spaCy, and jieba. |
| **Data & Auth** | Supabase | Auth via JWT/JWKS, and Postgres + RPC for profiles and background-synced user data. |
| **LLM / ML** | Anthropic Claude · scikit-learn | Claude generates in-context definitions and writing feedback; a versioned P(known) model personalizes word difficulty. |
