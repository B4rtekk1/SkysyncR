function EyeIcon({ open }: { open: boolean }) {
  return (
      <span className={`eye-icon ${open ? 'is-open' : 'is-closed'}`}>
        <svg className="eye-icon__layer eye-icon__layer--open" viewBox="0 0 24 24" width="18" height="18">
          <path
              d="M2 12C2 12 5.5 5.5 12 5.5C18.5 5.5 22 12 22 12C22 12 18.5 18.5 12 18.5C5.5 18.5 2 12 2 12Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <svg className="eye-icon__layer eye-icon__layer--closed" viewBox="0 0 24 24" width="18" height="18">
          <path
              d="M3 3L21 21"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
          />
          <path
              d="M10.6 5.7C11.05 5.57 11.51 5.5 12 5.5C18.5 5.5 22 12 22 12C22 12 21.1 13.65 19.4 15.25M6.5 6.9C4 8.6 2 12 2 12C2 12 5.5 18.5 12 18.5C13.6 18.5 15 18.1 16.2 17.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
          />
          <path
              d="M9.9 10C9.5 10.5 9.3 11.2 9.4 11.9C9.6 13.1 10.6 14 11.8 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
          />
        </svg>
      </span>
  )
}

export default EyeIcon
