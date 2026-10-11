import type { Portfolio, Incident } from '../../types';

export const setIncidentsLogic = (portfolio: Portfolio, incidents: Incident[]): Portfolio => ({
    ...portfolio,
    incidents
});

export const addIncidentLogic = (portfolio: Portfolio, incident: Incident): Portfolio => ({
    ...portfolio,
    incidents: [...portfolio.incidents, incident]
});

export const updateIncidentLogic = (portfolio: Portfolio, id: string, updates: Partial<Incident>): Portfolio => ({
    ...portfolio,
    incidents: portfolio.incidents.map(i => i.id === id ? { ...i, ...updates } : i)
});

export const deleteIncidentLogic = (portfolio: Portfolio, id: string): Portfolio => ({
    ...portfolio,
    incidents: portfolio.incidents.filter(i => i.id !== id)
});
