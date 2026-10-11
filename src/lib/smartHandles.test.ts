import { describe, expect, it } from 'vitest';
import { getSmartHandles } from './smartHandles';

describe('smartHandles utility', () => {
    it('returns s-right -> t-left when target is to the right of source', () => {
        const source = { position: { x: 100, y: 100 }, width: 160, height: 80 };
        const target = { position: { x: 400, y: 100 }, width: 160, height: 80 };

        const result = getSmartHandles(source, target);
        expect(result).toEqual({
            sourceHandleId: 's-right',
            targetHandleId: 't-left',
        });
    });

    it('returns s-left -> t-right when target is to the left of source', () => {
        const source = { position: { x: 400, y: 100 }, width: 160, height: 80 };
        const target = { position: { x: 100, y: 100 }, width: 160, height: 80 };

        const result = getSmartHandles(source, target);
        expect(result).toEqual({
            sourceHandleId: 's-left',
            targetHandleId: 't-right',
        });
    });

    it('returns s-bottom -> t-top when target is below source', () => {
        const source = { position: { x: 100, y: 100 }, width: 160, height: 80 };
        const target = { position: { x: 100, y: 400 }, width: 160, height: 80 };

        const result = getSmartHandles(source, target);
        expect(result).toEqual({
            sourceHandleId: 's-bottom',
            targetHandleId: 't-top',
        });
    });

    it('returns s-top -> t-bottom when target is above source', () => {
        const source = { position: { x: 100, y: 400 }, width: 160, height: 80 };
        const target = { position: { x: 100, y: 100 }, width: 160, height: 80 };

        const result = getSmartHandles(source, target);
        expect(result).toEqual({
            sourceHandleId: 's-top',
            targetHandleId: 't-bottom',
        });
    });
});
