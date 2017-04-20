#!/usr/bin/env node
/**
 * Parses the period indicators in order to generate the necessary stats
 * file for the population clocks.
 *
 * https://esa.un.org/unpd/wpp/Download/Standard/ASCII/
 *
 * Writes a JSON file to stdout. The file is an object,
 *
 * {
 *     "352": {
 *         "I": 352, // LocID field
 *         "L": "Iceland", // Location field
 *         "P": 323734, // Population as of 2013 (estimate based off stats in record)
 *         "B": 4407, // Births per year
 *         "D": 2054.8, // Deaths per year
 *         "BMP": 0.5090819833, // Percent of deaths that are male
 *         "DMP": 0.5021413276, // Percent of deaths that are male
 *         "DM": { // Male death age ranges
 *             "00-04": 0.00737,
 *             "05-14": 0.00213,
 *             "15-19": 0.0031,
 *             "20-24": 0.00581,
 *             "25-49": 0.05989,
 *             "49-59": 0.06707,
 *             "60-64": 0.05892,
 *             "65-69": 0.07715,
 *             "70-80": 0.22097,
 *             "80-90": 0.35627,
 *             "90+": 0.14131
 *         },
 *         "DF": { // Female death age ranges
 *             "00-04": 0.00469,
 *             "05-14": 0.00156,
 *             "15-19": 0.00273,
 *             "20-24": 0.00254,
 *             "25-49": 0.02913,
 *             "49-59": 0.04516,
 *             "60-64": 0.04496,
 *             "65-69": 0.05592,
 *             "70-80": 0.18572,
 *             "80-90": 0.38632,
 *             "90+": 0.24125
 *         }
 *     },
 *     ...
 * }
 *
 * Requires "csv" and "through2" libraries.
 */
"use strict";

var csv, decimalsForRanges, filename, fs, result, targetMidPeriod, through2, timePeriodScale;


/**
 * Shortens a number so it can be represented in JSON in a smaller form.
 *
 * @param {number} n
 * @param {number} decimalPlaces
 * @return {number}
 */
function shorten(n, decimalPlaces) {
    n = n || 0;

    return +n.toFixed(decimalPlaces);
}


/**
 * Makes a guess as to the population size
 *
 * Births = number in thousands, CBR is birth rate per 1000.
 * Deaths = number in thousands, CDR is death rate per 1000.
 * NetMigrations = number in thousands, CNMR is migration rate per
 * 1000.
 *
 * Using those relationships, we can guess the population and average the
 * three numbers.
 *
 * @param {Object} record
 * @return {integer} population Actual number, not in thousands.
 */
function estimatePopulation(record) {
    var actual, population, rate;

    /**
     * Here's where we do our guessing
     *
     * @param {number} num In thousands
     * @param {number} rate
     * @return {number}
     */
    function guess(num, rate) {
        num = +num || 0;
        rate = +rate || 0;
        
        if (!rate) {
            return 0;
        }

        // Actual number covers 5 years
        num /= timePeriodScale;

        // Actual number is in thousands
        num *= 1000;

        // Result should be in actual, not 1000
        return num / rate * 1000;
    }

    // Use the value that is the biggest (furthest away from zero).
    actual = record.Births;
    rate = record.CBR;

    if (actual < record.Deaths) {
        actual = record.Deaths;
        rate = record.CDR;
    }

    // Migrations can be negative
    if (actual < Math.abs(record.NetMigrations)) {
        actual = record.NetMigrations;
        rate = record.CNMR;
    }

    population = Math.floor(guess(actual, rate));

    return population;
}


/**
 * Builds a structure for easier determination of a person's estimated death.
 *
 * The statistics are generated to make it easier for a program to simulate
 * actual events.
 *
 * {
 *     "00-05": 0.021234781562,
 *     "05-15": 0.011246942,
 * ]
 *
 * @param {Object} record
 * @param {string} suffix
 * @return {Object} The statistics
 */
function gatherDeathStats(record, suffix) {
    /**
     * Return the percentage of deaths for a given age range.
     *
     * @param {string} range
     * @return {number}
     */
    function pct(range) {
        return record[`percDeath${range}${suffix}`] / 100;
    }

    return {
        "00-04": shorten(pct("0004"), decimalsForRanges),
        "05-14": shorten(pct("0514"), decimalsForRanges),
        "15-19": shorten(pct("0019") - pct("0014"), decimalsForRanges),
        "20-24": shorten(pct("0024") - pct("0019"), decimalsForRanges),
        "25-49": shorten(pct("1549") - pct("1524"), decimalsForRanges),
        "49-59": shorten(pct("1559") - pct("1549"), decimalsForRanges),
        "60-64": shorten(pct("6099") - pct("6599"), decimalsForRanges),
        "65-69": shorten(pct("6599") - pct("7099"), decimalsForRanges),
        "70-80": shorten(pct("7099") - pct("8099"), decimalsForRanges),
        "80-90": shorten(pct("8099") - pct("9099"), decimalsForRanges),
        "90+": shorten(pct("9099"), decimalsForRanges)
    };
}


csv = require("csv");
fs = require("fs");
through2 = require("through2");
filename = "WPP2015_DB01_Period_Indicators.csv";
targetMidPeriod = 2013;
timePeriodScale = 5;  // The birth/death rate counts are for a multi-year span
decimalsForRanges = 10;
result = {};

fs.createReadStream(filename, {
    encoding: "binary"
})
    .pipe(through2(function (data, enc, callback) {
        var s;

        // Convert the data so Curaçao (LocID 531) and others look good.
        s = data.toString("utf8");
        this.push(Buffer.from(s, "utf8"));
        callback();
    }))
    .pipe(csv.parse({
        auto_parse: true,
        columns: true
    }))
    .pipe(through2.obj(function (record, enc, callback) {
        var newRecord;

        // Only look for our time period and a "Medium" projection. Since
        // this data is in the past, there's really no projection. It's
        // a pretty solid estimate as to the actual numbers.
        if (record.MidPeriod === targetMidPeriod && record.VarID === 2) {
            newRecord = {
                // Shorten LocID and Location property names
                I: record.LocID,
                L: record.Location,
                P: estimatePopulation(record),

                // Convert away from thousands and the multi-year values.
                // Use Births/Deaths per year.
                B: shorten(record.Births / timePeriodScale * 1000, 2),
                D: shorten(record.Deaths / timePeriodScale * 1000, 2),

                // Calculate some percentages and the death probabilities
                BMP: shorten(record.SRB / (record.SRB + 1), 4),
                DMP: shorten(record.DeathsMale / record.Deaths, 4),
                DM: gatherDeathStats(record, "M"),
                DF: gatherDeathStats(record, "F")
            };

            this.push(newRecord);
        }

        callback();
    }))
    .on("data", (record) => {
        result[record.I] = record;
    })
    .on("end", () => {
        console.log(JSON.stringify(result));
    });
