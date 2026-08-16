from flask import Blueprint, jsonify, request
from ..auth import require_maintainer
from ..services.api_asset_service import ApiAssetError, api_asset_service

api_asset_bp=Blueprint("api_assets",__name__)
def call(fn, success=200):
    try: return jsonify(fn()), success
    except ApiAssetError as error: return jsonify({"error":error.to_dict()}), error.status
@api_asset_bp.get("")
def list_assets(): return call(lambda:{"items":api_asset_service.get_assets(request.args.get("keyword"),request.args.get("status"),request.args.get("method"),request.args.get("downstreamSystemId"))})
@api_asset_bp.get("/downstream-systems")
def downstream_systems(): return call(lambda:{"items":api_asset_service.get_downstream_systems(request.args.get("keyword"))})
@api_asset_bp.get("/systems")
def systems(): return call(lambda:{"items":api_asset_service.get_downstream_systems(request.args.get("keyword"))})
@api_asset_bp.get("/<api_code>")
def detail(api_code): return call(lambda:{"data":api_asset_service.get_asset(api_code)})
@api_asset_bp.post("")
@require_maintainer
def create(): return call(lambda:{"message":"API asset created","data":api_asset_service.create(request.get_json(silent=True))},201)
@api_asset_bp.put("/<api_code>")
@require_maintainer
def update(api_code): return call(lambda:{"message":"API asset updated","data":api_asset_service.update(api_code,request.get_json(silent=True))})
@api_asset_bp.patch("/<api_code>/status")
@require_maintainer
def status(api_code): return call(lambda:{"message":"API asset status updated","data":api_asset_service.update_status(api_code,request.get_json(silent=True))})
@api_asset_bp.delete("/<api_code>")
@require_maintainer
def delete(api_code): return call(lambda:(api_asset_service.delete(api_code),{"message":"API asset deleted"})[1])
@api_asset_bp.put("/<api_code>/params")
@require_maintainer
def params(api_code): return call(lambda:{"message":"API params updated","data":api_asset_service.replace_rows(api_code,request.get_json(silent=True).get("items") if isinstance(request.get_json(silent=True),dict) else None,"params")})
@api_asset_bp.put("/<api_code>/response-fields")
@require_maintainer
def response_fields(api_code): return call(lambda:{"message":"API response fields updated","data":api_asset_service.replace_rows(api_code,request.get_json(silent=True).get("items") if isinstance(request.get_json(silent=True),dict) else None,"responseFields")})
@api_asset_bp.put("/<api_code>/relations")
@require_maintainer
def relations(api_code): return call(lambda:{"message":"API relations updated","data":api_asset_service.replace_rows(api_code,request.get_json(silent=True).get("items") if isinstance(request.get_json(silent=True),dict) else None,"relations")})
