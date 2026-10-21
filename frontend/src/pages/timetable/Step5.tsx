import React from 'react';
import { Button } from '../../components/ui/Button';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { useToast } from '../../components/ui/useToast';
import { apiClient } from '../../api/client';
import { useWizard } from './WizardContext';

/**
 * Step 5 — run the solver.
 *
 * POST /api/timetable/generate runs the heuristic solver server-side (it is
 * dispatched to a worker thread so the event loop stays free), then
 * GET /api/timetable/{division_id} reads back the persisted slots.
 */
export interface Step5Props {
  onGenerateComplete: () => void;
}

export const Step5: React.FC<Step5Props> = ({ onGenerateComplete }) => {
  const { divisionId, isGenerating, setIsGenerating, setSlots, prevStep } = useWizard();
  const { showToast } = useToast();

  const handleGenerate = async () => {
    if (divisionId === null) {
      showToast({
        type: 'error',
        title: 'No Division Selected',
        message: 'Select a division before generating.',
      });
      return;
    }

    setIsGenerating(true);
    try {
      const { error } = await apiClient.POST('/api/timetable/generate', {
        body: { division_id: divisionId },
      });
      if (error) {
        showToast({
          type: 'error',
          title: 'Generation Failed',
          message: 'Could not generate the timetable.',
        });
        return;
      }

      const slotsRes = await apiClient.GET('/api/timetable/{division_id}', {
        params: { path: { division_id: divisionId } },
      });
      console.log('Fetched Timetable Data:', slotsRes.data, slotsRes.error);
      if (slotsRes.error) {
        showToast({
          type: 'error',
          title: 'Could Not Load Timetable',
          message: 'The timetable was generated but could not be loaded.',
        });
        return;
      }

      setSlots(slotsRes.data ?? []);
      showToast({
        type: 'success',
        title: 'Timetable Generated',
        message: `${slotsRes.data?.length ?? 0} slots scheduled.`,
      });
      onGenerateComplete();
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Generation Failed',
        message: 'Could not generate the timetable.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-base text-slate-900">Generate Timetable</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          The solver places theory, practical and tutorial periods so that no teacher or room is
          double-booked.
        </p>
      </div>

      <div className="border border-slate-200 rounded bg-slate-50 p-4 text-xs text-slate-600 space-y-1.5">
        <p className="font-semibold text-slate-700">What the solver enforces</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>No teacher is booked in two places at once</li>
          <li>No room is booked in two places at once</li>
          <li>A practical is exactly two consecutive periods, same room and teacher</li>
          <li>Every batch of the division practises in the same time block</li>
          <li>Visiting faculty are only scheduled inside their available hours</li>
          <li>Each teacher's daily lecture cap is respected</li>
        </ul>
      </div>

      <div className="flex justify-between pt-1">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={prevStep}
          disabled={isGenerating}
        >
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleGenerate}
          isLoading={isGenerating}
        >
          {isGenerating ? 'Generating...' : 'Generate Timetable'}
        </Button>
      </div>

      {isGenerating && (
        <div className="flex items-center gap-2 text-slate-500 text-xs">
          <LoadingSpinner size="sm" />
          <span>Running the solver — this can take a few seconds.</span>
        </div>
      )}
    </div>
  );
};
