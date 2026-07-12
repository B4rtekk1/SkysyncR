import { MOON_ICON, SUN_ICON, useTheme } from '../hooks/UseTheme'

type ThemeToggleProps = {
  className: string
}

function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      className={className}
      onClick={(event) => toggleTheme({ x: event.clientX, y: event.clientY })}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      type="button"
    >
      {theme === 'dark' ? SUN_ICON : MOON_ICON}
    </button>
  )
}

export default ThemeToggle
