// A single targeting-reticle corner mark, reused at all four corners of a panel via
// `rotation` rather than four separately-drawn variants — matches the corner accent marks
// on the reference HUD boards (a plain L would read flatter/more generic).
const CORNER_POSITION = {
  tl: 'top-0 left-0',
  tr: 'top-0 right-0',
  br: 'bottom-0 right-0',
  bl: 'bottom-0 left-0',
}

const CORNER_ROTATION = {
  tl: 0,
  tr: 90,
  br: 180,
  bl: 270,
}

export default function ReticleCorner({ corner, size = 16, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`absolute pointer-events-none ${CORNER_POSITION[corner]} ${className}`}
      style={{ transform: `rotate(${CORNER_ROTATION[corner]}deg)` }}
    >
      <path d="M1.5 9 V1.5 H9" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M1.5 13.5 H4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}
