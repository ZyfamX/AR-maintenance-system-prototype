# FastAPI routing, app setup, and mounting the static folder

import json
import os
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import List

# Import Pydantic schemas to validate data going out
from schemas import FaultOut, ToolOut

app = FastAPI(title="AR Maintenance System API")

# Reads data from a JSON file in the data/ directory
def read_json(filename: str):

    filepath = os.path.join("data", filename)

    if not os.path.exists(filepath):
        return []
    with open(filepath, "r") as file:
        return json.load(file)

def write_json(filename: str, data: list):
    filepath = os.path.join("data", filename)
    with open(filepath, "w") as file:
        json.dump(data, file, indent=4)


# ensure the server is running
@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Server is running"}


# Returns a list of all faults from the JSON database
@app.get("/api/faults", response_model=List[FaultOut])
def get_active_faults():
    faults = read_json("faults.json")
    return faults


# Returns a list of all tools from the JSON database
@app.get("/api/tools", response_model=List[ToolOut])
def get_all_tools():
    tools = read_json("tools.json")
    return tools


app.mount("/static", StaticFiles(directory="static"), name="static")
@app.get("/")
def serve_home():
    return FileResponse("static/index.html")
