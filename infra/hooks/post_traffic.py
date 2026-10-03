import json
import os
import urllib.request

import boto3

codedeploy = boto3.client("codedeploy")


def handler(event, _context):
    deployment_id = event["DeploymentId"]
    hook_execution_id = event["LifecycleEventHookExecutionId"]
    api_url = os.environ["API_URL"].rstrip("/")
    status = "Failed"

    try:
        request = urllib.request.Request(
            api_url + "/api/readyz",
            headers={"User-Agent": "LastRide-PostTrafficHook/1.0"},
        )
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
            if response.status == 200 and payload.get("status") == "ready":
                status = "Succeeded"
    except Exception as exc:
        print(json.dumps({"message": "post-traffic readiness failed", "error": str(exc)}))

    codedeploy.put_lifecycle_event_hook_execution_status(
        deploymentId=deployment_id,
        lifecycleEventHookExecutionId=hook_execution_id,
        status=status,
    )
    return {"status": status}
