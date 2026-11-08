"""Connected Unity project (Settings → Unity project): status, connect, choose folder, disconnect.

Changing it only accepts requests from this computer and the FrameMind frontend, and is refused while an analysis
runs (that analysis keeps the project it started with).
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.errors import AppError, require_local_request
from app.db.database import get_db
from app.schemas.unity_project import (
    ChosenFolderOut,
    UnityFolderListOut,
    UnityFolderOut,
    UnityFoldersSelect,
    UnityProjectConnect,
    UnityProjectOut,
)
from app.services import analysis, unity_project

router = APIRouter(prefix="/unity-project", tags=["unity project"])


def _out(project: unity_project.UnityProject) -> UnityProjectOut:
    return UnityProjectOut(
        supported=unity_project.supported(),
        connected=True,
        path=str(project.root),
        name=project.name,
        unity_version=project.unity_version,
        text_serialization=project.text_serialization,
        folders=project.folders,
        missing_folders=project.missing_folders,
        error_code=None,
        error=None,
    )


def _status() -> UnityProjectOut:
    try:
        project = unity_project.connected()
    except AppError as exc:
        path = unity_project.connected_path()
        return UnityProjectOut(
            supported=unity_project.supported(),
            connected=True,
            path=path,
            name=path.rstrip("/").rsplit("/", 1)[-1] if path else None,
            unity_version=None,
            text_serialization=None,
            error_code=exc.code,
            error=exc.message,
        )
    if project is None:
        return UnityProjectOut(
            supported=unity_project.supported(), connected=False, path=None, name=None, unity_version=None,
            text_serialization=None, error_code=None, error=None,
        )
    return _out(project)


def _no_active_analysis(db: Session) -> None:
    if analysis.has_active_job(db):
        raise AppError(409, "analysis_in_progress", "Wait for the running analysis to finish first.")


@router.get("", response_model=UnityProjectOut, summary="Connected Unity project")
def get_project() -> UnityProjectOut:
    return _status()


@router.put(
    "",
    response_model=UnityProjectOut,
    summary="Connect a Unity project folder",
    description="Analyze will let Codex read its Assets/, ProjectSettings/ and Packages/ folders (read-only).",
    dependencies=[Depends(require_local_request)],
)
def connect_project(data: UnityProjectConnect, db: Session = Depends(get_db)) -> UnityProjectOut:
    _no_active_analysis(db)
    return _out(unity_project.connect(data.path))


@router.post(
    "/choose",
    response_model=ChosenFolderOut,
    summary="Pick a folder in the macOS dialog",
    description="Opens the folder picker on this computer and returns the chosen path (not connected yet).",
    dependencies=[Depends(require_local_request)],
)
def choose_folder() -> ChosenFolderOut:
    return ChosenFolderOut(path=unity_project.choose_folder())


@router.get(
    "/folders",
    response_model=UnityFolderListOut,
    summary="Sub-folders of a project folder",
    description="`parent` is project-relative; empty = the folders that can be chosen (Assets, ProjectSettings, Packages).",
)
def list_folders(parent: str = Query("", max_length=1024)) -> UnityFolderListOut:
    folders = [UnityFolderOut(**f) for f in unity_project.list_folders(parent)]
    return UnityFolderListOut(parent=parent.strip().strip("/"), folders=folders)


@router.put(
    "/folders",
    response_model=UnityProjectOut,
    summary="Choose the folders Codex may read",
    description="Only these folders (and what is inside them) are readable during Analyze. [] = videos only.",
    dependencies=[Depends(require_local_request)],
)
def set_folders(data: UnityFoldersSelect, db: Session = Depends(get_db)) -> UnityProjectOut:
    _no_active_analysis(db)
    return _out(unity_project.set_folders(data.folders))


@router.delete(
    "",
    response_model=UnityProjectOut,
    summary="Disconnect the Unity project",
    description="Analyze goes back to the videos only. Nothing in the project folder is touched.",
    dependencies=[Depends(require_local_request)],
)
def disconnect_project(db: Session = Depends(get_db)) -> UnityProjectOut:
    _no_active_analysis(db)
    unity_project.disconnect()
    return _status()
