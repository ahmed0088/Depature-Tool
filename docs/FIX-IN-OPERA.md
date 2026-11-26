# Fix in Opera (v626)

Immigration Check → **Fix in Opera** card. Upload the Opera immigration report and the Vicas Inhouse XML as before.

1. The card lists guests whose **gender, nationality or ID number** is empty in the report and the value Vicas (or the title) suggests. Matching is by **room + name**; two guests in a room that fit the same name are never guessed.
2. Edit a value if needed and tick what is approved. Nationality from Vicas is on by default; gender guesses and **every ID number** need your tap. Press **Copy plan for the Opera fixer**.
3. In Opera Cloud open the console (F12), paste `tools/hotelops-opera-fixer.console.js`, paste the plan, **Load plan**.
4. Pick a room, open that guest's profile in Opera, press **Check & fill**. It checks the name on screen, fills only empty fields (a masked number counts as filled), highlights them and **stops**. You press Save.
5. **Dry run** is on by default: untick it to actually type.
6. After a session press **Copy log** in the fixer and paste it in the card's **Save log for the team**.

Safety: the fixer never clicks Save, OK, Submit, Apply, Confirm, Done, Yes, Delete or Cancel. ID numbers live only in the browser tab (the copied plan contains them: do not share it). The shared record and the log keep gender and nationality codes and **only the last 4 of an ID number**, never names. Nothing real goes into the repo; tests use made-up guests and a mock Opera page.

Not done (v2): opening each room by itself, auto-save, Emirates ID type code confirmation (the plan proposes `EID`; the fixer fills it only if Opera's list has it, otherwise type it yourself).
