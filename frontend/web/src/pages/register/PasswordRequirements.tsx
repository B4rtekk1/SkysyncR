import { getPasswordRequirements, getPasswordScore, getStrengthLevel } from './passwordRules'

function PasswordRequirements({ password }: { password: string }) {
  const requirements = getPasswordRequirements(password)
  const score = getPasswordScore(password)
  const strength = getStrengthLevel(score)

  return (
      <div className="password-requirements">
        <div className="password-requirements__header">
          <div className="password-requirements__bar">
            {[0, 1, 2, 3, 4].map((i) => (
                <span
                    key={i}
                    className={`password-requirements__segment ${
                        i < strength.segments ? `is-filled is-${strength.className}` : ''
                    }`}
                />
            ))}
          </div>
          <span className={`password-requirements__strength-label is-${strength.className}`}>
            {strength.label}
          </span>
        </div>

        <ul className="password-requirements__list">
          {requirements.map((req) => (
              <li
                  key={req.label}
                  className={`password-requirements__item ${req.met ? 'is-met' : ''}`}
              >
                <span className="password-requirements__icon" aria-hidden="true">
                  {req.met ? (
                      <svg viewBox="0 0 16 16" width="10" height="10">
                        <path
                            d="M3 8.5L6.2 11.5L13 4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                      </svg>
                  ) : (
                      <svg viewBox="0 0 16 16" width="10" height="10">
                        <path
                            d="M4 4L12 12M12 4L4 12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                        />
                      </svg>
                  )}
                </span>
                {req.label}
              </li>
          ))}
        </ul>
      </div>
  )
}

export default PasswordRequirements
