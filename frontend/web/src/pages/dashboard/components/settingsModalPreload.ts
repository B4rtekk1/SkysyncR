const loadSettingsModal = () => import('../../Settings')

// Warm up the settings chunk before the user clicks the button. This keeps the
// initial dashboard bundle small while making the first modal open immediate.
export function preloadSettingsModal() {
    void loadSettingsModal()
}

export { loadSettingsModal }
