from flask import Blueprint, jsonify, request

from ..services.indicator_path_service import IndicatorPathDataSourceError, indicator_path_service


indicator_path_bp = Blueprint("indicator_path", __name__)


@indicator_path_bp.get("/tree")
def get_indicator_path_tree():
    try:
        items = indicator_path_service.get_path_tree(dimension_code=request.args.get("dimensionCode"))
    except IndicatorPathDataSourceError as error:
        return jsonify({"error": error.to_dict()}), 500
    return jsonify(items)
