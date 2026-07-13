import { forwardRef } from 'react'

type FileRenameInputProps = {
    filename: string
    value: string
    disabled: boolean
    onChange: (value: string) => void
    onSave: () => void
    onCancel: () => void
}

export const FileRenameInput = forwardRef<HTMLInputElement, FileRenameInputProps>(function FileRenameInput(
    { filename, value, disabled, onChange, onSave, onCancel },
    ref,
) {
    return (
        <input
            className="file-card__rename-input"
            type="text"
            value={value}
            ref={ref}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    e.preventDefault()
                    onCancel()
                } else if (e.key === 'Enter') {
                    e.preventDefault()
                    onSave()
                }
            }}
            onClick={(e) => e.stopPropagation()}
            disabled={disabled}
            aria-label={`Rename ${filename}`}
        />
    )
})
