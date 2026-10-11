import type { PortfolioSlice, IncidentSlice } from './types';
import { setIncidentsLogic, addIncidentLogic, updateIncidentLogic, deleteIncidentLogic } from '../actions/incidentActions';

export const createIncidentSlice: PortfolioSlice<IncidentSlice> = (set) => ({
    setIncidents: (incidents) => set((state) => ({
        portfolio: setIncidentsLogic(state.portfolio, incidents),
    })),
    addIncident: (incident) => set((state) => ({
        portfolio: addIncidentLogic(state.portfolio, incident),
    })),
    updateIncident: (id, updates) => set((state) => ({
        portfolio: updateIncidentLogic(state.portfolio, id, updates),
    })),
    deleteIncident: (id) => set((state) => ({
        portfolio: deleteIncidentLogic(state.portfolio, id),
    })),
});
