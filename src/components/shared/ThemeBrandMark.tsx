import type { CSSProperties } from 'react';
import { useThemeBrand } from '../../context/ThemeContext';
import type { ThemeBrandPresentation } from '../../theme/themePresentation';
import { NemotoIcon } from './NemotoIcon';

interface ThemeBrandMarkProps {
    presentation?: ThemeBrandPresentation;
    size?: number;
    showName?: boolean;
    className?: string;
    logoClassName?: string;
    nameClassName?: string;
    style?: CSSProperties;
}

export function ThemeBrandMark({
    presentation: presentationOverride,
    size = 28,
    showName = true,
    className = '',
    logoClassName = '',
    nameClassName = '',
    style,
}: ThemeBrandMarkProps) {
    const activePresentation = useThemeBrand();
    const presentation = presentationOverride || activePresentation;

    return (
        <div className={`flex min-w-0 items-center gap-3 ${className}`.trim()} style={style}>
            {presentation.logoDataUrl ? (
                <img
                    aria-hidden="true"
                    alt=""
                    src={presentation.logoDataUrl}
                    style={{ height: size, width: 'auto', maxWidth: size * 5 }}
                    className={`shrink-0 object-contain ${logoClassName}`.trim()}
                />
            ) : (
                <NemotoIcon size={size} className={`shrink-0 ${logoClassName}`.trim()} />
            )}
            {showName && presentation.showDisplayName !== false && (
                <span className={`truncate font-bold text-sm tracking-tight text-text-main ${nameClassName}`.trim()}>
                    {presentation.displayName}
                </span>
            )}
        </div>
    );
}
