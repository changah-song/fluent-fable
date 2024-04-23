from fastapi import FastAPI
from konlpy.tag import Okt
from konlpy.tag import Kkma
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
okt = Okt()
kkma = Kkma()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/okt_morphs/")
async def get_okt_morphs(text: str):
    morphs = okt.pos(text, stem=True)
    return {"result": morphs}

@app.get("/kkma_morphs/")
async def get_kkma_morphs(text: str):
    morphs = kkma.morphs(text)
    return {"result": morphs}