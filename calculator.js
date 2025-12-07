let projectionsData = [];
let portfolioChartInstance = null;
let histogramChartInstance = null;

// Set today's date on load and try to load defaults from `defaults.json`
window.addEventListener('DOMContentLoaded', () => {
    setToday();
    // Try to fetch defaults.json from the same folder
    fetchDefaultsAndApply();
});

async function fetchDefaultsAndApply() {
    try {
        const resp = await fetch('defaults.json');
        if (!resp.ok) throw new Error('Failed to fetch defaults.json: ' + resp.status);
        const defaults = await resp.json();
        applyDefaults(defaults);
        console.log('Defaults loaded from defaults.json');
    } catch (err) {
        // Fetch may fail when opening the file via file:// protocol. That's expected.
        const msg = 'Could not load defaults.json (fetch). If you opened the file directly with file:// this is expected. Serve the folder with a local HTTP server to load defaults.json, or use the "Load defaults JSON" file picker.';
        console.warn(msg, err);
        const serverMsgEl = document.getElementById('serverMsg');
        if (serverMsgEl) serverMsgEl.textContent = msg;
    }
}

function applyDefaults(defaults) {
    // Map keys in defaults to element IDs where applicable
    Object.keys(defaults).forEach(key => {
        try {
            const el = document.getElementById(key);
            if (!el) return;
            if (el.type === 'checkbox') {
                el.checked = Boolean(defaults[key]);
            } else {
                el.value = defaults[key];
            }
        } catch (e) {
            // ignore invalid assignments
        }
    });
}

// File picker fallback: load defaults from a user-selected JSON file
function loadDefaultsFromFile(event) {
    const file = event?.target?.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const json = JSON.parse(e.target.result);
            applyDefaults(json);
            const serverMsgEl = document.getElementById('serverMsg');
            if (serverMsgEl) serverMsgEl.textContent = 'Defaults loaded from selected file.';
        } catch (err) {
            alert('Failed to parse JSON file: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function setToday() {
    document.getElementById('currentDate').value = new Date().toISOString().slice(0, 10);
}

function getInputs() {
    return {
        currentDate: document.getElementById('currentDate').value,
        yourBirthdate: document.getElementById('yourBirthdate').value,
        spouseBirthdate: document.getElementById('spouseBirthdate').value,
        retirementAge: parseFloat(document.getElementById('retirementAge').value),
        maxAge: parseFloat(document.getElementById('maxAge').value),
        taxableAccounts: parseFloat(document.getElementById('taxableAccounts').value),
        retirementAccounts: parseFloat(document.getElementById('retirementAccounts').value),
        annualExpenses: parseFloat(document.getElementById('annualExpenses').value),
        yourSSAge: parseFloat(document.getElementById('yourSSAge').value),
        yourSSBenefitAtFRA: parseFloat(document.getElementById('yourSSBenefitAtFRA').value),
        spouseSSAge: parseFloat(document.getElementById('spouseSSAge').value),
        spouseOwnBenefit: parseFloat(document.getElementById('spouseOwnBenefit').value),
        inflationRate: parseFloat(document.getElementById('inflationRate').value),
        returnRate: parseFloat(document.getElementById('returnRate').value),
        taxRate: parseFloat(document.getElementById('taxRate').value),
        stdDev: parseFloat(document.getElementById('stdDev').value),
        simulations: parseInt(document.getElementById('simulations').value),
        seed: parseInt(document.getElementById('seed').value)
    };
}

function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

function calculateAge(birthdate, currentDate) {
    const today = new Date(currentDate);
    const birth = new Date(birthdate);
    return Math.floor((today.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

function calculateProjections() {
    const inputs = getInputs();
    const results = [];
    
    let taxable = inputs.taxableAccounts;
    let retirement = inputs.retirementAccounts;
    let yourAge = calculateAge(inputs.yourBirthdate, inputs.currentDate);
    let spouseAge = calculateAge(inputs.spouseBirthdate, inputs.currentDate);
    
    const yourFRA = 67;
    const spouseFRA = 67;
    
    // Calculate first year fraction
    const today = new Date(inputs.currentDate);
    const birth = new Date(inputs.yourBirthdate);
    const nextBirthday = new Date(birth);
    nextBirthday.setFullYear(today.getFullYear());
    if (today > nextBirthday) nextBirthday.setFullYear(today.getFullYear() + 1);
    const msRemaining = nextBirthday.getTime() - today.getTime();
    const msInYear = 365.25 * 24 * 60 * 60 * 1000;
    let firstYearFraction = Math.max(0, Math.min(1, msRemaining / msInYear));
    
    let isFirstYear = true;
    let yearIdx = 0;
    
    while (yourAge <= inputs.maxAge) {
        const inflationMultiplier = Math.pow(1 + inputs.inflationRate / 100, yearIdx);
        const adjustedExpenses = inputs.annualExpenses * inflationMultiplier * (isFirstYear ? firstYearFraction : 1);
        
        // Calculate SS income
        let yourSSIncome = 0;
        if (yourAge >= inputs.yourSSAge) {
            const delayYears = inputs.yourSSAge - yourFRA;
            const earlyYears = yourFRA - inputs.yourSSAge;
            const ssMultiplier = delayYears > 0 ? 1 + (delayYears * 0.08) : 1 - (earlyYears * 0.067);
            yourSSIncome = inputs.yourSSBenefitAtFRA * ssMultiplier * inflationMultiplier * (isFirstYear ? firstYearFraction : 1);
        }
        
        let spouseSSIncome = 0;
        if (spouseAge >= inputs.spouseSSAge && yourAge >= inputs.yourSSAge) {
            const spousalBenefit = inputs.yourSSBenefitAtFRA * 0.5;
            let adjustedSpousalBenefit = spousalBenefit;
            if (inputs.spouseSSAge < spouseFRA) {
                const earlyYears = spouseFRA - inputs.spouseSSAge;
                adjustedSpousalBenefit = spousalBenefit * (1 - earlyYears * 0.067);
            }
            spouseSSIncome = Math.max(inputs.spouseOwnBenefit, adjustedSpousalBenefit) * inflationMultiplier * (isFirstYear ? firstYearFraction : 1);
        }
        
        const totalSSIncome = yourSSIncome + spouseSSIncome;
        const ssTaxable = totalSSIncome * 0.85;
        const ssTaxes = ssTaxable * (inputs.taxRate / 100);
        const netSSIncome = totalSSIncome - ssTaxes;
        
        // Calculate net withdrawal needed (expenses - SS income)
        const netNeeded = yourAge >= inputs.retirementAge ? adjustedExpenses - netSSIncome : 0;
        
        // Withdraw BEFORE applying returns
        let taxableWithdrawal = 0;
        let retirementWithdrawal = 0;
        let withdrawalTaxes = 0;
        
        if (netNeeded > 0) {
            // Solve for gross withdrawal accounting for taxes
            // For taxable: grossWithdrawal = netNeeded + (netNeeded * 0.5 * taxRate) / (1 - 0.5 * taxRate)
            // Simplified: grossWithdrawal = netNeeded / (1 - 0.5 * taxRate)
            const taxableEffectiveRate = 0.5 * (inputs.taxRate / 100);
            const grossNeededFromTaxable = netNeeded / (1 - taxableEffectiveRate);
            
            if (taxable >= grossNeededFromTaxable) {
                // Can cover entirely from taxable
                taxableWithdrawal = grossNeededFromTaxable;
                withdrawalTaxes = grossNeededFromTaxable * taxableEffectiveRate;
                taxable -= taxableWithdrawal;
            } else if (taxable > 0) {
                // Partial from taxable, rest from retirement
                taxableWithdrawal = taxable;
                withdrawalTaxes = taxable * taxableEffectiveRate;
                const netFromTaxable = taxable - withdrawalTaxes;
                const stillNeeded = netNeeded - netFromTaxable;
                // For retirement accounts, gross = net / (1 - taxRate)
                retirementWithdrawal = stillNeeded / (1 - inputs.taxRate / 100);
                withdrawalTaxes += retirementWithdrawal * (inputs.taxRate / 100);
                taxable = 0;
                retirement -= retirementWithdrawal;
            } else {
                // All from retirement
                retirementWithdrawal = netNeeded / (1 - inputs.taxRate / 100);
                withdrawalTaxes = retirementWithdrawal * (inputs.taxRate / 100);
                retirement -= retirementWithdrawal;
            }
        }
        
        // Store balance before returns for withdrawal rate
        const totalBeforeReturns = taxable + retirement;
        
        // Apply returns AFTER withdrawals
        const totalAfterWithdrawal = taxable + retirement;
        const returnAmount = totalAfterWithdrawal * (inputs.returnRate / 100) * (isFirstYear ? firstYearFraction : 1);
        taxable += returnAmount * (taxable / (totalAfterWithdrawal || 1));
        retirement += returnAmount * (retirement / (totalAfterWithdrawal || 1));
        
        // RMDs
        let rmdAmount = 0;
        let rmdTaxes = 0;
        if (yourAge >= 73 && retirement > 0) {
            const rmdTable = {
                73: 27.4, 74: 26.5, 75: 25.5, 76: 24.6, 77: 23.7, 78: 22.9, 79: 22.0, 80: 21.1,
                81: 20.2, 82: 19.4, 83: 18.5, 84: 17.7, 85: 16.8, 86: 16.0, 87: 15.2, 88: 14.4,
                89: 13.7, 90: 12.9, 91: 12.2, 92: 11.5, 93: 10.8, 94: 10.1, 95: 9.5
            };
            const rmdFactor = rmdTable[yourAge] || 9.5;
            const requiredRmd = retirement / rmdFactor;
            if (requiredRmd > retirementWithdrawal) {
                rmdAmount = requiredRmd - retirementWithdrawal;
                retirement -= rmdAmount;
                rmdTaxes = rmdAmount * (inputs.taxRate / 100);
                taxable += rmdAmount - rmdTaxes;
            }
        }
        
        const totalTaxes = ssTaxes + withdrawalTaxes;
        const totalTaxesPaid = totalTaxes + rmdTaxes;
        const totalGrossWithdrawal = taxableWithdrawal + retirementWithdrawal + rmdAmount;
        const total = taxable + retirement;
        const withdrawalRate = totalBeforeReturns > 0 ? (totalGrossWithdrawal / totalBeforeReturns * 100) : 0;
        
        results.push({
            yourAge,
            spouseAge,
            year: yearIdx + 1,
            taxable: Math.max(0, taxable),
            retirement: Math.max(0, retirement),
            total: Math.max(0, total),
            expenses: yourAge >= inputs.retirementAge ? adjustedExpenses : 0,
            yourSSIncome,
            spouseSSIncome,
            totalSSIncome,
            netSSIncome,
            withdrawal: totalGrossWithdrawal,
            taxes: totalTaxesPaid,
            withdrawalRate: withdrawalRate.toFixed(2)
        });
        
        if (total <= 0 && yourAge >= inputs.retirementAge) break;
        
        yourAge++;
        spouseAge++;
        isFirstYear = false;
        yearIdx++;
    }
    
    projectionsData = results;
    displayProjections(results, inputs);
}

function displayProjections(results, inputs) {
    document.getElementById('projectionsSection').style.display = 'block';
    
    const finalBalance = results[results.length - 1]?.total || 0;
    const moneyLasts = results[results.length - 1]?.yourAge || 0;
    
    const retirementYears = results.filter(p => p.yourAge >= inputs.retirementAge && p.withdrawal > 0);
    const avgWithdrawalRate = retirementYears.reduce((sum, p) => sum + parseFloat(p.withdrawalRate), 0) / (retirementYears.length || 1);
    
    document.getElementById('finalBalance').textContent = formatCurrency(finalBalance);
    document.getElementById('moneyLasts').textContent = moneyLasts;
    document.getElementById('avgWithdrawalRate').textContent = avgWithdrawalRate.toFixed(1) + '%';
    
    // Calculate SS benefits
    const yourFRA = 67;
    const yourDelayYears = inputs.yourSSAge - yourFRA;
    const yourEarlyYears = yourFRA - inputs.yourSSAge;
    const yourSSMultiplier = yourDelayYears > 0 ? 1 + (yourDelayYears * 0.08) : 1 - (yourEarlyYears * 0.067);
    const yourActualBenefit = inputs.yourSSBenefitAtFRA * yourSSMultiplier;
    
    const spouseFRA = 67;
    const spousalBenefit = inputs.yourSSBenefitAtFRA * 0.5;
    let spouseActualBenefit = spousalBenefit;
    if (inputs.spouseSSAge < spouseFRA) {
        const spouseEarlyYears = spouseFRA - inputs.spouseSSAge;
        spouseActualBenefit = spousalBenefit * (1 - spouseEarlyYears * 0.067);
    }
    
    document.getElementById('yourBenefit').textContent = formatCurrency(yourActualBenefit);
    document.getElementById('spouseBenefit').textContent = formatCurrency(spouseActualBenefit);
    
    // Update table
    const tbody = document.getElementById('projectionsBody');
    tbody.innerHTML = '';
    results.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.year}</td>
            <td>${row.yourAge}</td>
            <td>${row.spouseAge}</td>
            <td>${formatCurrency(row.taxable)}</td>
            <td>${formatCurrency(row.retirement)}</td>
            <td>${formatCurrency(row.total)}</td>
            <td>${formatCurrency(row.expenses)}</td>
            <td>${formatCurrency(row.yourSSIncome)}</td>
            <td>${formatCurrency(row.spouseSSIncome)}</td>
            <td>${formatCurrency(row.netSSIncome)}</td>
            <td>${formatCurrency(row.withdrawal)}</td>
            <td>${formatCurrency(row.taxes)}</td>
            <td>${row.withdrawalRate}</td>
        `;
        tbody.appendChild(tr);
    });
    
    // Update chart
    updatePortfolioChart(results);
}

function updatePortfolioChart(results) {
    const ctx = document.getElementById('portfolioChart').getContext('2d');
    
    if (portfolioChartInstance) {
        portfolioChartInstance.destroy();
    }
    
    portfolioChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: results.map(r => r.yourAge),
            datasets: [
                {
                    label: 'Total',
                    data: results.map(r => r.total),
                    borderColor: '#8884d8',
                    backgroundColor: 'rgba(136, 132, 216, 0.1)',
                    tension: 0.1
                },
                {
                    label: 'Taxable',
                    data: results.map(r => r.taxable),
                    borderColor: '#82ca9d',
                    backgroundColor: 'rgba(130, 202, 157, 0.1)',
                    tension: 0.1
                },
                {
                    label: 'Retirement',
                    data: results.map(r => r.retirement),
                    borderColor: '#ffc658',
                    backgroundColor: 'rgba(255, 198, 88, 0.1)',
                    tension: 0.1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Portfolio Value Over Time'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Your Age'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Account Value ($)'
                    },
                    ticks: {
                        callback: function(value) {
                            return '$' + (value / 1000000).toFixed(1) + 'M';
                        }
                    }
                }
            }
        }
    });
}

// Seeded PRNG (Mulberry32)
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function runMonteCarlo() {
    const inputs = getInputs();
    const button = document.getElementById('mcButton');
    button.disabled = true;
    button.textContent = 'Running...';
    
    setTimeout(() => {
        const endBalances = [];
        let successCount = 0;
        const rng = inputs.seed ? mulberry32(inputs.seed) : Math.random;
        
        for (let i = 0; i < inputs.simulations; i++) {
            let taxable = inputs.taxableAccounts;
            let retirement = inputs.retirementAccounts;
            let yourAge = calculateAge(inputs.yourBirthdate, inputs.currentDate);
            let spouseAge = calculateAge(inputs.spouseBirthdate, inputs.currentDate);
            
            // Calculate first year fraction
            const today = new Date(inputs.currentDate);
            const birth = new Date(inputs.yourBirthdate);
            const nextBirthday = new Date(birth);
            nextBirthday.setFullYear(today.getFullYear());
            if (today > nextBirthday) nextBirthday.setFullYear(today.getFullYear() + 1);
            const msRemaining = nextBirthday.getTime() - today.getTime();
            const msInYear = 365.25 * 24 * 60 * 60 * 1000;
            let firstYearFraction = Math.max(0, Math.min(1, msRemaining / msInYear));
            
            let isFirstYear = true;
            let yearIdx = 0;
            let broke = false;
            
            while (yourAge <= inputs.maxAge) {
                // Random return
                const mean = inputs.returnRate / 100;
                const sd = inputs.stdDev / 100;
                const u1 = rng();
                const u2 = rng();
                const randStdNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
                const randomReturn = mean + sd * randStdNormal;
                
                const inflationMultiplier = Math.pow(1 + inputs.inflationRate / 100, yearIdx);
                const adjustedExpenses = inputs.annualExpenses * inflationMultiplier * (isFirstYear ? firstYearFraction : 1);
                
                // SS income (same logic as projections)
                let yourSSIncome = 0;
                if (yourAge >= inputs.yourSSAge) {
                    const yourFRA = 67;
                    const delayYears = inputs.yourSSAge - yourFRA;
                    const earlyYears = yourFRA - inputs.yourSSAge;
                    const ssMultiplier = delayYears > 0 ? 1 + (delayYears * 0.08) : 1 - (earlyYears * 0.067);
                    yourSSIncome = inputs.yourSSBenefitAtFRA * ssMultiplier * inflationMultiplier * (isFirstYear ? firstYearFraction : 1);
                }
                
                let spouseSSIncome = 0;
                if (spouseAge >= inputs.spouseSSAge && yourAge >= inputs.yourSSAge) {
                    const spouseFRA = 67;
                    const spousalBenefit = inputs.yourSSBenefitAtFRA * 0.5;
                    let adjustedSpousalBenefit = spousalBenefit;
                    if (inputs.spouseSSAge < spouseFRA) {
                        const earlyYears = spouseFRA - inputs.spouseSSAge;
                        adjustedSpousalBenefit = spousalBenefit * (1 - earlyYears * 0.067);
                    }
                    spouseSSIncome = Math.max(inputs.spouseOwnBenefit, adjustedSpousalBenefit) * inflationMultiplier * (isFirstYear ? firstYearFraction : 1);
                }
                
                const totalSSIncome = yourSSIncome + spouseSSIncome;
                const ssTaxable = totalSSIncome * 0.85;
                const ssTaxes = ssTaxable * (inputs.taxRate / 100);
                const netSSIncome = totalSSIncome - ssTaxes;
                
                // Calculate net withdrawal needed (expenses - SS income)
                const netNeeded = yourAge >= inputs.retirementAge ? adjustedExpenses - netSSIncome : 0;
                
                // Withdraw BEFORE returns
                if (netNeeded > 0) {
                    // Solve for gross withdrawal accounting for taxes
                    const taxableEffectiveRate = 0.5 * (inputs.taxRate / 100);
                    const grossNeededFromTaxable = netNeeded / (1 - taxableEffectiveRate);
                    
                    if (taxable >= grossNeededFromTaxable) {
                        // Can cover entirely from taxable
                        taxable -= grossNeededFromTaxable;
                    } else if (taxable > 0) {
                        // Partial from taxable, rest from retirement
                        const withdrawalTaxes = taxable * taxableEffectiveRate;
                        const netFromTaxable = taxable - withdrawalTaxes;
                        const stillNeeded = netNeeded - netFromTaxable;
                        const retirementWithdrawal = stillNeeded / (1 - inputs.taxRate / 100);
                        taxable = 0;
                        retirement -= retirementWithdrawal;
                    } else {
                        // All from retirement
                        const retirementWithdrawal = netNeeded / (1 - inputs.taxRate / 100);
                        retirement -= retirementWithdrawal;
                    }
                }
                
                // Apply returns AFTER withdrawals
                const totalAfterWithdrawal = taxable + retirement;
                const returnAmount = totalAfterWithdrawal * randomReturn * (isFirstYear ? firstYearFraction : 1);
                taxable += returnAmount * (taxable / (totalAfterWithdrawal || 1));
                retirement += returnAmount * (retirement / (totalAfterWithdrawal || 1));
                
                // RMDs
                if (yourAge >= 73 && retirement > 0) {
                    const rmdTable = {
                        73: 27.4, 74: 26.5, 75: 25.5, 76: 24.6, 77: 23.7, 78: 22.9, 79: 22.0, 80: 21.1,
                        81: 20.2, 82: 19.4, 83: 18.5, 84: 17.7, 85: 16.8, 86: 16.0, 87: 15.2, 88: 14.4,
                        89: 13.7, 90: 12.9, 91: 12.2, 92: 11.5, 93: 10.8, 94: 10.1, 95: 9.5
                    };
                    const rmdFactor = rmdTable[yourAge] || 9.5;
                    const requiredRmd = retirement / rmdFactor;
                    const rmdAmount = Math.max(0, requiredRmd);
                    retirement -= rmdAmount;
                    const rmdTaxes = rmdAmount * (inputs.taxRate / 100);
                    taxable += rmdAmount - rmdTaxes;
                }
                
                if ((taxable + retirement) <= 0 && yourAge >= inputs.retirementAge) {
                    broke = true;
                    break;
                }
                
                yourAge++;
                spouseAge++;
                isFirstYear = false;
                yearIdx++;
            }
            
            const endBalance = taxable + retirement;
            endBalances.push(endBalance);
            if (!broke) successCount++;
        }
        
        endBalances.sort((a, b) => a - b);
        const percentiles = [0.1, 0.25, 0.5, 0.75, 0.9].map(p => 
            endBalances[Math.floor(p * endBalances.length)] || 0
        );
        
        displayMonteCarloResults({
            successRate: (successCount / inputs.simulations) * 100,
            medianEndBalance: percentiles[2],
            percentiles,
            endBalances
        });
        
        button.disabled = false;
        button.textContent = 'Run Monte Carlo Simulation';
    }, 100);
}

function displayMonteCarloResults(results) {
    document.getElementById('monteCarloSection').style.display = 'block';
    
    document.getElementById('successRate').textContent = results.successRate.toFixed(2) + '%';
    document.getElementById('medianBalance').textContent = formatCurrency(results.medianEndBalance);
    
    const percentilesList = document.getElementById('percentilesList');
    percentilesList.innerHTML = '';
    const percentileLabels = [10, 20, 50, 75, 90];
    results.percentiles.forEach((p, idx) => {
        const li = document.createElement('li');
        li.textContent = `${percentileLabels[idx]}th Percentile: ${formatCurrency(p)}`;
        percentilesList.appendChild(li);
    });
    
    updateHistogram(results.endBalances);
}

function updateHistogram(endBalances) {
    const ctx = document.getElementById('histogramChart').getContext('2d');
    
    if (histogramChartInstance) {
        histogramChartInstance.destroy();
    }
    
    // Create bins
    const binWidth = 500000;
    const minVal = Math.min(...endBalances);
    const maxVal = Math.max(...endBalances);
    const minBin = Math.floor(Math.min(minVal, 0) / binWidth) * binWidth;
    const maxBin = Math.ceil(Math.max(maxVal, 0) / binWidth) * binWidth;
    const numBins = Math.ceil((maxBin - minBin) / binWidth);
    
    const bins = new Array(numBins).fill(0);
    endBalances.forEach(val => {
        const binIndex = Math.floor((val - minBin) / binWidth);
        if (binIndex >= 0 && binIndex < numBins) {
            bins[binIndex]++;
        }
    });
    
    const labels = bins.map((_, i) => {
        const binStart = minBin + i * binWidth;
        return formatCurrency(binStart + binWidth / 2);
    });
    
    // Get final balance from projections for reference line
    const finalBalance = projectionsData.length > 0 ? projectionsData[projectionsData.length - 1].total : 0;
    
    histogramChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Frequency',
                data: bins,
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Distribution of Final Portfolio Values'
                },
                annotation: {
                    annotations: {
                        line1: {
                            type: 'line',
                            xMin: formatCurrency(finalBalance),
                            xMax: formatCurrency(finalBalance),
                            borderColor: 'rgb(255, 99, 132)',
                            borderWidth: 2,
                            label: {
                                display: true,
                                content: 'Projection',
                                position: 'start'
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Final Balance'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Number of Simulations'
                    }
                }
            }
        }
    });
}
