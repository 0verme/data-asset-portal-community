from flask import Blueprint, jsonify, request

# Reader boundary only — must not import private scheduler collectors.
from ..services.lineage import (
    LineageValidationError,
    get_bootstrap,
    get_initial_view,
    get_subgraph,
    search_nodes,
)


lineage_bp = Blueprint("lineage", __name__)


@lineage_bp.get("/bootstrap")
def get_lineage_bootstrap():
    try:
        data = get_bootstrap()
    except LineageValidationError as error:
        return jsonify({"error": error.to_dict()}), getattr(error, "status_code", 422)
    return jsonify({"data": data})


@lineage_bp.get("/assets")
def get_lineage_assets():
    try:
        data = search_nodes(request.args.get("name"))
    except LineageValidationError as error:
        return jsonify({"error": error.to_dict()}), getattr(error, "status_code", 422)
    return jsonify({"data": data})


@lineage_bp.get("/subgraph")
def get_lineage_subgraph():
    try:
        data = get_subgraph(
            request.args.get("rootId"),
            request.args.get("direction", "both"),
            request.args.get("depth"),
            request.args.get("maxNodes"),
            request.args.get("view", "table"),
        )
    except LineageValidationError as error:
        return jsonify({"error": error.to_dict()}), getattr(error, "status_code", 422)
    return jsonify({"data": data})


@lineage_bp.get("/initial-view")
def get_lineage_initial_view():
    try:
        data = get_initial_view(
            request.args.get("rootId"),
            request.args.get("direction", "both"),
            request.args.get("depth"),
            request.args.get("maxNodes"),
            request.args.get("view", "table"),
        )
    except LineageValidationError as error:
        return jsonify({"error": error.to_dict()}), getattr(error, "status_code", 422)
    return jsonify({"data": data})
