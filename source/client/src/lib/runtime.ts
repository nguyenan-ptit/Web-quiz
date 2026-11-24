// Mock is opt-in; real rooms use the same origin through the Vite proxy.
export const mockEnabled = import.meta.env.VITE_MOCK_MODE === 'true';
