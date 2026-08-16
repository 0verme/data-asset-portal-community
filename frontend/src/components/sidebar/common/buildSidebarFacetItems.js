export function buildSidebarFacetItems({
  options = [],
  selectedValue = null,
  getValue = (option) => option,
  getLabel = (option) => option,
  getCount = () => null,
  onSelect,
  renderContent,
}) {
  return options.map((option) => {
    const value = getValue(option);
    const count = getCount(option);
    const active = selectedValue === value;

    return {
      key: String(value),
      label: getLabel(option),
      count,
      active,
      onClick: () => onSelect?.(active ? null : value, option),
      content: renderContent ? renderContent({ option, value, count, active }) : undefined,
    };
  });
}
