"""Admin endpoints for pipeline management."""
import os
from datetime import datetime
from enum import Enum
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/v1/admin", tags=["admin"])


class PipelineType(str, Enum):
    ANNUAL = "annual"
    DAILY = "daily"


class TriggerResponse(BaseModel):
    status: str
    run_id: Optional[str]
    message: str
    triggered_at: datetime


class WorkflowRun(BaseModel):
    id: int
    name: str
    status: str
    conclusion: Optional[str]
    created_at: datetime
    updated_at: datetime
    html_url: str


def verify_admin_key(request: Request) -> bool:
    """Verify admin key using constant-time comparison."""
    import hmac
    admin_key = os.getenv("ADMIN_API_KEY", "")
    provided_key = request.headers.get("X-Admin-Key", "")
    
    if not admin_key or not provided_key:
        return False
    
    return hmac.compare_digest(admin_key, provided_key)


def get_github_headers() -> dict:
    """Get headers for GitHub API."""
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        return {}
    return {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


@router.post("/trigger-pipeline")
async def trigger_pipeline(
    pipeline: PipelineType,
    request: Request,
) -> TriggerResponse:
    """
    Trigger a GitHub Actions workflow.
    
    Requires X-Admin-Key header with valid admin key.
    
    Available pipelines:
    - annual: Full annual data refresh (V-Dem, all sources)
    - daily: Daily update (latest alerts, scores)
    """
    if not verify_admin_key(request):
        raise HTTPException(status_code=401, detail="Invalid or missing admin key")
    
    github_token = os.getenv("GITHUB_TOKEN")
    repo = os.getenv("GITHUB_REPO", "kuro-toji/democratic-decay-monitor")
    workflow_id = f"{pipeline.value}-pipeline.yml"
    
    if not github_token:
        raise HTTPException(
            status_code=503,
            detail="GitHub token not configured. Set GITHUB_TOKEN environment variable."
        )
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://api.github.com/repos/{repo}/actions/workflows/{workflow_id}/dispatches",
                headers=get_github_headers(),
                json={"ref": "main"},
                timeout=30.0,
            )
            
            if response.status_code == 204:
                return TriggerResponse(
                    status="triggered",
                    run_id=None,
                    message=f"Pipeline '{pipeline.value}' triggered successfully",
                    triggered_at=datetime.utcnow(),
                )
            elif response.status_code == 401:
                raise HTTPException(status_code=401, detail="GitHub authentication failed")
            elif response.status_code == 404:
                raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")
            else:
                error_detail = response.json().get("message", "Unknown error")
                raise HTTPException(status_code=response.status_code, detail=error_detail)
                
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="GitHub API timeout")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"GitHub API error: {str(e)}")


@router.get("/pipeline-status", response_model=list[WorkflowRun])
async def get_pipeline_status(request: Request) -> list[WorkflowRun]:
    """
    Get status of recent workflow runs.
    
    Returns the last 5 workflow runs from all pipelines.
    """
    if not verify_admin_key(request):
        raise HTTPException(status_code=401, detail="Invalid or missing admin key")
    
    github_token = os.getenv("GITHUB_TOKEN")
    repo = os.getenv("GITHUB_REPO", "kuro-toji/democratic-decay-monitor")
    
    if not github_token:
        raise HTTPException(
            status_code=503,
            detail="GitHub token not configured"
        )
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://api.github.com/repos/{repo}/actions/runs",
                headers=get_github_headers(),
                params={"per_page": 10, "exclude_pull_requests": True},
                timeout=30.0,
            )
            
            if response.status_code == 200:
                data = response.json()
                runs = []
                
                for run in data.get("workflow_runs", []):
                    runs.append(WorkflowRun(
                        id=run["id"],
                        name=run["name"],
                        status=run["status"],
                        conclusion=run["conclusion"],
                        created_at=datetime.fromisoformat(run["created_at"].replace("Z", "+00:00")),
                        updated_at=datetime.fromisoformat(run["updated_at"].replace("Z", "+00:00")),
                        html_url=run["html_url"],
                    ))
                
                return runs
            else:
                raise HTTPException(status_code=response.status_code, detail="Failed to fetch workflow runs")
                
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="GitHub API timeout")
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"GitHub API error: {str(e)}")
