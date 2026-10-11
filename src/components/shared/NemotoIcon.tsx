import { useId } from "react";
import "./NemotoIcon.css";

/** Approved Nemoto mark; unique gradient IDs support multiple brand previews. */
export function NemotoIcon({ size = 28, className = "" }: { size?: number | string; className?: string }) {
 const id = useId().replace(/:/g, "");
 return (
<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 5 192 160" width={size} height={size} aria-hidden="true" className={`nemoto-mark ${className}`}>
  <defs>
    <linearGradient id={`${id}-leaf`} gradientUnits="userSpaceOnUse" x1="150" y1="88" x2="196" y2="15">
      <stop offset="0" stopColor="var(--nemoto-green)"/><stop offset="1" stopColor="var(--nemoto-tip)"/>
    </linearGradient>
    <linearGradient id={`${id}-small`} gradientUnits="userSpaceOnUse" x1="154" y1="93" x2="116" y2="46">
      <stop offset="0" stopColor="var(--nemoto-green)"/><stop offset="1" stopColor="var(--nemoto-tip)"/>
    </linearGradient>
  </defs>

  
  <g fill="none" strokeLinecap="round" strokeLinejoin="round">
    
    <path d="M35 101 H92" stroke="var(--nemoto-ink)" strokeWidth="8"/>
    
    <path d="M101 110 V122 C101 133 106 139 115 139" stroke="var(--nemoto-ink)" strokeWidth="8"/>
    
    <path d="M110 101 H136 C147 101 154 97 154 88" stroke="var(--nemoto-green)" strokeWidth="8" strokeLinecap="butt"/>
  </g>

  
  <circle cx="35" cy="101" r="12.7" fill="var(--nemoto-ink)"/>
  <circle cx="115" cy="139" r="11.6" fill="var(--nemoto-outcome)"/>
  <path d="M101 84 L118 101 L101 118 L84 101 Z" fill="var(--nemoto-ink)"/>

  
  <path d="M154 93 C140 82 122 78 118 60 C117 54 116 50 116 46 C136 47 152 64 154 93 Z" fill={`url(#${id}-small)`}/>
  
  <path d="M136 101 C147 101 154 97 154 88" fill="none" stroke="var(--nemoto-green)" strokeWidth="8"/>
  
  <path d="M150 88 C148 62 156 38 172 26 C181 18 189 15 196 15 C197 40 189 58 172 70 C165 75 160 80 158 88 Z" fill={`url(#${id}-leaf)`}/>
</svg>

 );
}
