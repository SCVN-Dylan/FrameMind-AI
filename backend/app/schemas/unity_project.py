from typing import List, Optional

from pydantic import BaseModel, Field


class RecentUnityProjectOut(BaseModel):
    """A project used before; connecting it again restores its chosen folders."""

    path: str
    name: str
    folder_count: int
    # False when its folder can't be found (moved, deleted, drive not mounted).
    available: bool


class UnityProjectOut(BaseModel):
    """The Unity project Analyze may read. `connected` false = analysis uses the videos only."""

    # False on platforms where reading a project is not available yet (Windows).
    supported: bool
    connected: bool
    path: Optional[str]
    name: Optional[str]
    unity_version: Optional[str]
    # True = Force Text serialization (scenes/prefabs readable), False = binary or mixed, null = unknown.
    text_serialization: Optional[bool]
    # Project-relative folders Codex may read ("Assets/Scenes"). Empty = analysis uses the videos only.
    folders: List[str] = []
    # Chosen folders that no longer exist (not readable).
    missing_folders: List[str] = []
    # Set when a project is connected but its folder can't be read any more.
    error_code: Optional[str]
    error: Optional[str]
    # Projects used before, most recent first (the connected one included).
    recent: List[RecentUnityProjectOut] = []


class UnityProjectConnect(BaseModel):
    path: str = Field(min_length=1, max_length=1024)


class UnityFoldersSelect(BaseModel):
    """Replaces the folders Codex may read. [] = analysis uses the videos only."""

    folders: List[str] = Field(default_factory=list, max_length=50)


class UnityFolderOut(BaseModel):
    path: str
    name: str
    has_children: bool


class UnityFolderListOut(BaseModel):
    parent: str
    folders: List[UnityFolderOut]


class ChosenFolderOut(BaseModel):
    """The folder picked in the macOS dialog; null = the dialog was cancelled."""

    path: Optional[str]
