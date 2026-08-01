const loadSettingsModal = () => import('../../Settings')

export function preloadSettingsModal() {
    void loadSettingsModal()
}

export { loadSettingsModal }
