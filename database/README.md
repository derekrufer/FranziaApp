# Database Notes

The scaffold runs with an in-memory backend store so you can test the draft room immediately.

The PostgreSQL schema is ready for the next step:

1. Import teams.
2. Import current player pool.
3. Import last year's draft results.
4. Import end-of-year rosters.
5. Generate keeper options.
6. Save selected keepers.
7. Generate `draft_picks`.

Keeper rules represented by the schema:

- Last year's Round 1 and Round 2 picks are not keeper eligible.
- Drafted players cost two rounds earlier than last year.
- Undrafted end-of-season roster players cost Round 10.
- Keeper rights belong to the team holding the player at season end.
- Pick ownership lives on `draft_picks.current_owner_team_id`, which allows traded picks.
