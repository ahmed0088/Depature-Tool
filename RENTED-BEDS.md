# Rented Rooms & Beds

Open **Rented Rooms & Beds**. Two independent views are available:

- **Monthly worksheet** keeps the original daily rooms/beds copy workflow and adds **Download Excel**.
- **Year / custom report** accepts a full-year export, several monthly exports, or any selected date range. Upload your reports, choose **Full year** or set **From / Through**, confirm the room setup, and download Excel.

## Reports and counting

Use Opera **Statistics – Room Type (`statroomtype`)**, exported with every room type. The report needs `BUSINESS_DATE`, `STAY_ROOMS` and a room-type code (normally `LABEL`). History Forecast (`CONSIDERED_DATE`, `NO_ROOMS`) is optional for a cross-check. TXT, TSV, CSV, Excel and the existing Room Type PDF layout are supported; Delimited Data is preferred for reliable reading.

Rooms are the sum of rented rooms per date. Beds are each room type's rented rooms multiplied by its configured beds per room. For example, 100 king rooms × 1 plus 20 twin rooms × 2 gives 120 rented rooms and 140 rented beds. Monthly and annual totals add these daily counts: **room-nights and bed-nights**, not unique physical beds, guests, occupied guests or money.

A room-type file filtered to twin/selected types needs History Forecast. Uncheck **includes every room type**; other types then use a one-bed baseline. Verify that assumption for your hotel. History Forecast alone can supply rooms but cannot establish a nonzero bed count without room-type data.

The room setup is saved per HotelOps hotel and Opera property. New room types show suggested values and must be confirmed. Change a value and press **Save** to recalculate. No guest records, financial records or source reports are changed.

## Coverage and overlapping files

Full dates are retained across months, years and leap days. Identical overlapping date/type rows count once. Conflicting copies and History Forecast / full-room-type mismatches exclude that date until the source files are corrected or an outdated file is removed. Missing dates stay blank and are excluded, not converted to zero. A report can be downloaded with unresolved checks, but is clearly labelled **Partial / checks required**.

If source files contain several Opera property codes, select one property. Unlabelled files form their own group; they are not combined with a known property. The report hotel name labels the workbook and does not change the property filter.

**Full year** selects January 1 through December 31, including missing days. **Use all uploaded dates** selects the earliest through latest uploaded date. Once you choose a custom/full-year range, adding another file keeps it selected.

## Excel workbook

The `.xlsx` contains six sheets: **Summary**, **Monthly totals**, **Daily totals**, **Room setup**, **Source records**, and **Checks**. It includes the hotel, property, selected range, Dubai generation time, numeric counts, grand totals, alternating rows, filters, frozen headings and a landscape print layout. Missing values are blank. Source records are supporting evidence and must not be added on top of the displayed totals.

The monthly Excel button downloads a workbook from the monthly inputs without changing the independent year/custom report or its uploaded files. Multi-month files are directed to the period report instead of being counted by day number in the monthly worksheet.

Reports are processed locally in your browser. Source files remain in the current session; only room setup is saved on this device. No automation is started by exporting.
