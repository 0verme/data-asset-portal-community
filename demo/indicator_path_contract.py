"""Shared validation and relational seed projection for demo indicator paths."""

from __future__ import annotations

from typing import Any

PATH_SEPARATOR = " > "


def flatten_indicator_path_tree(path_tree: Any) -> list[dict[str, Any]]:
    """Project the canonical nested path catalog into seed-table rows.

    The JSON tree intentionally omits repeated ``dimensionCode`` values from
    descendants. Every persisted node inherits its root's dimension, preventing
    category/leaf codes from accidentally being treated as separate dimensions.
    """
    if not isinstance(path_tree, list) or not path_tree:
        raise ValueError("indicator_paths.json: expected a non-empty root array")

    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    seen_codes: set[str] = set()
    next_id = 1

    def visit(
        node: Any,
        *,
        parent_id: int | None,
        root_dimension: str | None,
        level: int,
        parent_full_path: str,
        sibling_order: int,
        parent_code: str | None,
    ) -> None:
        nonlocal next_id
        location = parent_code or "<root>"
        if not isinstance(node, dict):
            errors.append(f"indicator_paths.json: node under {location!r} must be an object")
            return

        path_code = node.get("pathCode")
        path_name = node.get("pathName")
        if not isinstance(path_code, str) or not path_code.strip():
            errors.append(f"indicator_paths.json: node under {location!r} has no pathCode")
            return
        if not isinstance(path_name, str) or not path_name.strip():
            errors.append(f"indicator_paths.json: node {path_code!r} has no pathName")
            return
        path_code = path_code.strip()
        path_name = path_name.strip()
        if path_code in seen_codes:
            errors.append(f"indicator_paths.json: duplicate pathCode {path_code!r}")
        seen_codes.add(path_code)

        if level == 1:
            dimension_value = node.get("dimensionCode")
            if not isinstance(dimension_value, str) or not dimension_value.strip():
                errors.append(f"indicator_paths.json: root {path_code!r} has no dimensionCode")
                dimension_code = ""
            else:
                dimension_code = dimension_value.strip()
                if dimension_code != dimension_code.lower():
                    errors.append(
                        f"indicator_paths.json: root {path_code!r} dimensionCode must be lowercase"
                    )
                if path_code != dimension_code.upper():
                    errors.append(
                        f"indicator_paths.json: root {path_code!r} must equal dimensionCode.upper()"
                    )
        else:
            dimension_code = root_dimension or ""
            declared_dimension = node.get("dimensionCode")
            if declared_dimension is not None and declared_dimension != dimension_code:
                errors.append(
                    f"indicator_paths.json: node {path_code!r} overrides root dimensionCode "
                    f"{dimension_code!r} with {declared_dimension!r}"
                )

        sort_order = node.get("sortOrder", sibling_order)
        if isinstance(sort_order, bool) or not isinstance(sort_order, int) or sort_order < 1:
            errors.append(f"indicator_paths.json: node {path_code!r} has invalid sortOrder")
            sort_order = sibling_order

        full_path = f"{parent_full_path}/{path_code}" if parent_full_path else path_code
        node_id = next_id
        next_id += 1
        rows.append(
            {
                "id": node_id,
                "parentId": parent_id,
                "pathCode": path_code,
                "pathName": path_name,
                "dimensionCode": dimension_code,
                "pathLevel": level,
                "fullPath": full_path,
                "sortOrder": sort_order,
                "status": node.get("status", "enabled"),
                "remark": node.get("remark")
                or (
                    "演示指标维度根路径"
                    if level == 1
                    else "演示指标路径分类"
                    if level == 2
                    else "演示指标路径主题"
                ),
            }
        )

        children = node.get("children", [])
        if not isinstance(children, list):
            errors.append(f"indicator_paths.json: children of {path_code!r} must be an array")
            return
        if level >= 3 and children:
            errors.append(f"indicator_paths.json: leaf {path_code!r} must not have children")
            return
        if level < 3 and not children:
            errors.append(f"indicator_paths.json: non-leaf {path_code!r} has no children")
        if level >= 3:
            return

        child_codes: set[str] = set()
        child_names: set[str] = set()
        child_orders: set[int] = set()
        for index, child in enumerate(children, start=1):
            if isinstance(child, dict):
                child_code = child.get("pathCode")
                child_name = child.get("pathName")
                child_order = child.get("sortOrder", index)
                if isinstance(child_code, str) and child_code in child_codes:
                    errors.append(
                        f"indicator_paths.json: duplicate sibling pathCode {child_code!r} under {path_code!r}"
                    )
                if isinstance(child_name, str) and child_name in child_names:
                    errors.append(
                        f"indicator_paths.json: duplicate sibling pathName {child_name!r} under {path_code!r}"
                    )
                if isinstance(child_order, int) and not isinstance(child_order, bool):
                    if child_order in child_orders:
                        errors.append(
                            f"indicator_paths.json: duplicate sortOrder {child_order} under {path_code!r}"
                        )
                    child_orders.add(child_order)
                if isinstance(child_code, str):
                    child_codes.add(child_code)
                if isinstance(child_name, str):
                    child_names.add(child_name)
            visit(
                child,
                parent_id=node_id,
                root_dimension=dimension_code,
                level=level + 1,
                parent_full_path=full_path,
                sibling_order=index,
                parent_code=path_code,
            )

    root_codes: set[str] = set()
    root_orders: set[int] = set()
    for index, root in enumerate(path_tree, start=1):
        if isinstance(root, dict):
            code = root.get("pathCode")
            order = root.get("sortOrder", index)
            if isinstance(code, str) and code in root_codes:
                errors.append(f"indicator_paths.json: duplicate root pathCode {code!r}")
            if isinstance(order, int) and not isinstance(order, bool):
                if order in root_orders:
                    errors.append(f"indicator_paths.json: duplicate root sortOrder {order}")
                root_orders.add(order)
            if isinstance(code, str):
                root_codes.add(code)
        visit(
            root,
            parent_id=None,
            root_dimension=None,
            level=1,
            parent_full_path="",
            sibling_order=index,
            parent_code=None,
        )

    if errors:
        raise ValueError("\n".join(errors))
    return rows


def indicator_path_contract_errors(path_tree: Any, indicators: Any) -> list[str]:
    """Return actionable errors if Demo indicator paths do not map to the tree."""
    try:
        rows = flatten_indicator_path_tree(path_tree)
    except ValueError as error:
        return str(error).splitlines()

    roots = [row for row in rows if row["parentId"] is None]
    by_code = {row["pathCode"]: row for row in rows}
    children_by_parent: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        if row["parentId"] is not None:
            children_by_parent.setdefault(row["parentId"], []).append(row)

    root_dimensions = [row["dimensionCode"] for row in roots]
    if len(root_dimensions) != len(set(root_dimensions)):
        return ["indicator_paths.json: root dimensionCode values must be unique"]

    if not isinstance(indicators, list):
        return ["indicators.json: expected an array"]

    expected_dimensions: set[str] = set()
    errors: list[str] = []
    for indicator in indicators:
        if not isinstance(indicator, dict):
            errors.append("indicators.json: every indicator must be an object")
            continue
        indicator_code = str(indicator.get("code") or "").strip()
        path_desc = indicator.get("pathDesc")
        if not indicator_code:
            errors.append("indicators.json: indicator has no code")
            continue
        expected_dimension = indicator_code[:3].lower()
        expected_dimensions.add(expected_dimension)
        if not isinstance(path_desc, str) or not path_desc.strip():
            errors.append(f"indicator {indicator_code}: pathDesc is empty")
            continue
        segments = [segment.strip() for segment in path_desc.split(PATH_SEPARATOR)]
        if any(not segment for segment in segments):
            errors.append(f"indicator {indicator_code}: pathDesc contains an empty segment")
            continue
        if len(segments) != 3:
            errors.append(
                f"indicator {indicator_code}: expected root > category > topic, got {len(segments)} segments"
            )
            continue

        current = by_code.get(segments[0])
        if current is None or current["parentId"] is not None:
            errors.append(
                f"indicator {indicator_code}: missing root path node {segments[0]!r}"
            )
            continue
        if current["dimensionCode"] != expected_dimension:
            errors.append(
                f"indicator {indicator_code}: root {segments[0]!r} has dimensionCode "
                f"{current['dimensionCode']!r}, expected {expected_dimension!r}"
            )
            continue

        for segment in segments[1:]:
            matches = [
                child
                for child in children_by_parent.get(current["id"], [])
                if child["pathName"] == segment
            ]
            if not matches:
                parent_path = current["fullPath"].replace("/", PATH_SEPARATOR)
                errors.append(
                    f"indicator {indicator_code}: missing path node {segment!r} under {parent_path!r}"
                )
                current = None
                break
            current = matches[0]
            if current["dimensionCode"] != expected_dimension:
                errors.append(
                    f"indicator {indicator_code}: path node {segment!r} has dimensionCode "
                    f"{current['dimensionCode']!r}, expected {expected_dimension!r}"
                )
                current = None
                break
        if current is not None and children_by_parent.get(current["id"]):
            errors.append(
                f"indicator {indicator_code}: pathDesc ends at non-leaf node {current['pathCode']!r}"
            )

    missing_dimensions = sorted(expected_dimensions - set(root_dimensions))
    unused_dimensions = sorted(set(root_dimensions) - expected_dimensions)
    if missing_dimensions:
        errors.append(
            "indicator_paths.json: missing dimension roots for " + ", ".join(missing_dimensions)
        )
    if unused_dimensions:
        errors.append(
            "indicator_paths.json: roots have no matching demo indicators: "
            + ", ".join(unused_dimensions)
        )
    return errors


def validate_indicator_path_contract(path_tree: Any, indicators: Any) -> None:
    errors = indicator_path_contract_errors(path_tree, indicators)
    if errors:
        raise ValueError("Demo indicator path contract invalid:\n- " + "\n- ".join(errors))
