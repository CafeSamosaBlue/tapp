import React from "react";
import FileSaver from "file-saver";
import {
    exportApplicants,
    applicantsSelector,
    upsertApplicants,
} from "../../api/actions";
import { useSelector, useDispatch } from "react-redux";
import { ExportActionButton } from "../../components/export-button";
import { ImportActionButton } from "../../components/import-button";
import { Alert } from "react-bootstrap";
import { normalizeImport, dataToFile } from "../../libs/importExportUtils";
import { prepareMinimal } from "../../libs/exportUtils";
import { diffImport, getChanged, DiffSpec } from "../../libs/diffUtils";
import { Applicant, MinimalApplicant } from "../../api/defs/types";
import {
    ApplicantsList,
    ApplicantsDiffList,
} from "../../components/applicants";

/**
 * Allows for the download of a file blob containing the exported instructors.
 * Instructors are synchronized from the server before being downloaded.
 *
 * @export
 * @returns
 */
export function ConnectedExportApplicantsAction() {
    const dispatch = useDispatch();
    const [exportType, setExportType] = React.useState<
        "spreadsheet" | "json" | null
    >(null);

    React.useEffect(() => {
        if (!exportType) {
            return;
        }

        async function doExport() {
            // Having an export type of `null` means we're ready to export again,
            // We set the export type to null at the start so in case an error occurs,
            // we can still try again. This *will not* affect the current value of `exportType`
            setExportType(null);

            // Make a function that converts a list of instructors into a `File` object.
            function prepareData(
                applicants: Applicant[],
                dataFormat: "csv" | "json" | "xlsx"
            ) {
                return dataToFile(
                    {
                        toSpreadsheet: () =>
                            [
                                [
                                    "Last Name",
                                    "First Name",
                                    "UTORid",
                                    "Student Number",
                                    "email",
                                    "Phone",
                                ],
                            ].concat(
                                applicants.map((applicant) => [
                                    applicant.last_name,
                                    applicant.first_name,
                                    applicant.utorid,
                                    applicant.student_number,
                                    applicant.email,
                                    applicant.phone,
                                ])
                            ),
                        toJson: () => ({
                            applicants: applicants.map((applicant) =>
                                prepareMinimal.applicant(applicant)
                            ),
                        }),
                    },
                    dataFormat,
                    "applicants"
                );
            }

            const file = await dispatch(
                exportApplicants(prepareData, exportType)
            );

            FileSaver.saveAs(file);
        }
        doExport().catch(console.error);
    }, [exportType, dispatch]);

    function onClick(option: "spreadsheet" | "json") {
        setExportType(option);
    }

    return <ExportActionButton onClick={onClick} />;
}

const applicantSchema = {
    keys: [
        "first_name",
        "last_name",
        "utorid",
        "email",
        "student_number",
        "phone",
    ],
    keyMap: {
        "First Name": "first_name",
        "Given Name": "first_name",
        First: "first_name",
        "Last Name": "last_name",
        Surname: "last_name",
        "Family Name": "last_name",
        Last: "last_name",
        "Student Number": "student_number",
    },
    requiredKeys: ["utorid"],
    primaryKey: "utorid",
    dateColumns: [],
    baseName: "applicants",
};

export function ConnectedImportInstructorAction() {
    const dispatch = useDispatch();
    const applicants = useSelector(applicantsSelector);
    const [fileContent, setFileContent] = React.useState<{
        fileType: "json" | "spreadsheet";
        data: any;
    } | null>(null);
    const [diffed, setDiffed] = React.useState<
        DiffSpec<MinimalApplicant, Applicant>[] | null
    >(null);
    const [processingError, setProcessingError] = React.useState(null);
    const [inProgress, setInProgress] = React.useState(false);

    // Make sure we aren't showing any diff if there's no file loaded.
    React.useEffect(() => {
        if (!fileContent) {
            if (diffed) {
                setDiffed(null);
            }
        }
    }, [diffed, setDiffed, fileContent]);

    // Recompute the diff every time the file changes
    React.useEffect(() => {
        // If we have no file or we are currently in the middle of processing another file,
        // do nothing.
        if (!fileContent || inProgress) {
            return;
        }
        try {
            setProcessingError(null);
            // normalize the data coming from the file
            const data = normalizeImport(
                fileContent,
                applicantSchema
            ) as MinimalApplicant[];
            // Compute which applicants have been added/modified
            const newDiff = diffImport.applicants(data, { applicants });

            setDiffed(newDiff);
        } catch (e) {
            console.warn(e);
            setProcessingError(e);
        }
    }, [fileContent, applicants, inProgress]);

    async function onConfirm() {
        if (!diffed) {
            throw new Error("Unable to compute an appropriate diff");
        }
        const changedApplicants = getChanged(diffed);

        await dispatch(upsertApplicants(changedApplicants));

        setFileContent(null);
    }

    let dialogContent = <p>No data loaded...</p>;
    if (processingError) {
        dialogContent = <Alert variant="danger">{"" + processingError}</Alert>;
    } else if (diffed) {
        const newItems = diffed
            .filter((item) => item.status === "new")
            .map((item) => item.obj);
        const modifiedDiffSpec = diffed.filter(
            (item) => item.status === "modified"
        );

        if (newItems.length === 0 && modifiedDiffSpec.length === 0) {
            dialogContent = (
                <Alert variant="warning">
                    No difference between imported applicants and those already
                    on the system.
                </Alert>
            );
        } else {
            dialogContent = (
                <>
                    {newItems.length > 0 && (
                        <Alert variant="primary">
                            <span className="mb-1">
                                The following applicants will be{" "}
                                <strong>added</strong>
                            </span>
                            <ApplicantsList applicants={newItems} />
                        </Alert>
                    )}
                    {modifiedDiffSpec.length > 0 && (
                        <Alert variant="info">
                            <span className="mb-1">
                                The following instructors will be{" "}
                                <strong>modified</strong>
                            </span>
                            <ApplicantsDiffList
                                modifiedApplicants={modifiedDiffSpec}
                            />
                        </Alert>
                    )}
                </>
            );
        }
    }

    return (
        <ImportActionButton
            onConfirm={onConfirm}
            onFileChange={setFileContent}
            dialogContent={dialogContent}
            setInProgress={setInProgress}
        />
    );
}
