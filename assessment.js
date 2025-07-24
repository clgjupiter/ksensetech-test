const axios = require('axios');

const API_KEY = 'ak_0bf5e427082358f70e90a3db0678a2ff8d7326d8db1e7272';
const BASE_URL = 'https://assessment.ksensetech.com/api';

const HEADERS = {
    'x-api-key': API_KEY,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPatients() {
    let patients = [];
    let page = 1;
    let hasNext = true;

    while (hasNext) {
        try {
            const res = await axios.get(`${BASE_URL}/patients?page=${page}&limit=5`, { headers: HEADERS });

            const responseData = res.data;

            if (!responseData || !Array.isArray(responseData.data)) {
                console.warn(`Invalid data on page ${page}, skipping...`);
                page++;
                continue;
            }

            const { data, pagination } = responseData;

            patients.push(...data);
            hasNext = pagination?.hasNext ?? false;
            page++;
        } catch (err) {
            const status = err.response?.status;

            if (status === 429 || status === 500 || status === 503) {
                console.warn(`Retrying page ${page} due to error ${status}`);
                await sleep(1000); // backoff
            } else {
                console.error(`Failed on page ${page} `, err.message);
                page++;
            }
        }
    }

    return patients;
}

function parseBP(bp) {
    if (!bp || typeof bp !== 'string') return [null, null];
    const parts = bp.split('/');
    if (parts.length !== 2) return [null, null];
    const [s, d] = parts.map(Number);
    return [isNaN(s) ? null : s, isNaN(d) ? null : d];
}

function scoreBP(bp) {
    const [systolic, diastolic] = parseBP(bp);
    if (systolic === null || diastolic === null) return 0;
    if (systolic < 120 && diastolic < 80) return 0;
    if (systolic >= 120 && systolic <= 129 && diastolic < 80) return 1;
    if ((systolic >= 130 && systolic <= 139) || (diastolic >= 80 && diastolic <= 89)) return 2;
    if (systolic >= 140 || diastolic >= 90) return 3;
    return 0;
}

function scoreTemp(temp) {
    const t = parseFloat(temp);
    if (isNaN(t)) return 0;
    if (t <= 99.5) return 0;
    if (t <= 100.9) return 1;
    return 2;
}

function scoreAge(age) {
    const a = parseInt(age);
    if (isNaN(a)) return 0;
    if (a < 40) return 0;
    if (a <= 65) return 1;
    return 2;
}

function isInvalidBP(bp) {
    const [s, d] = parseBP(bp);
    return s === null || d === null;
}

function isInvalidTemp(temp) {
    return isNaN(parseFloat(temp));
}

function isInvalidAge(age) {
    return isNaN(parseInt(age));
}

function evaluatePatients(patients) {
    const highRisk = [];
    const feverPatients = [];
    const dataIssues = [];

    for (const p of patients) {
        const bpScore = scoreBP(p.blood_pressure);
        const tempScore = scoreTemp(p.temperature);
        const ageScore = scoreAge(p.age);
        const totalRisk = bpScore + tempScore + ageScore;

        if (totalRisk >= 4) highRisk.push(p.patient_id);
        if (!isNaN(parseFloat(p.temperature)) && parseFloat(p.temperature) >= 99.6)
            feverPatients.push(p.patient_id);
        if (isInvalidBP(p.blood_pressure) || isInvalidTemp(p.temperature) || isInvalidAge(p.age))
            dataIssues.push(p.patient_id);
    }

    return { high_risk_patients: highRisk, fever_patients: feverPatients, data_quality_issues: dataIssues };
}

async function submitAssessment(result) {
    const payload = {
        high_risk_patients: result.high_risk_patients ?? [],
        fever_patients: result.fever_patients ?? [],
        data_quality_issues: result.data_quality_issues ?? [],
    };

    console.log("Payload to submit:\n", JSON.stringify(payload, null, 2));

    try {
        const res = await axios.post(
            `${BASE_URL}/submit-assessment`,
            payload,
            {
                headers: {
                    ...HEADERS,
                    'Content-Type': 'application/json',
                },
            }
        );
        console.log('✅ Submission successful:', res.data);
    } catch (err) {
        console.error('Submission failed:', err.message);
    }
}

(async () => {
    console.log('Fetching patients...');
    const patients = await fetchPatients();
    console.log(`Fetched ${patients.length} patients.`);

    const assessment = evaluatePatients(patients);
    console.log('Assessment result:', assessment);

    await submitAssessment(assessment);
})();