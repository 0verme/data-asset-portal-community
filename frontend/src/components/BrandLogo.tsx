import React from 'react';

export interface BrandLogoProps {
  src: string;
  alt: string;
  className?: string | undefined;
}

export function BrandLogo({ src, alt, className }: BrandLogoProps): React.ReactElement {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  return (
    <img
      src={failed ? '/brand-icon.svg' : src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
