// Extracted from the existing benchmark; do not edit computed values by hand.
export const SKY_BENCHMARK_DATA = {
  "source": "docs/evidence/rito-updated-grb-pipeline-benchmark-1000-20260908.json",
  "sourceSha256": "1cf2512b67606699ff148011df77f69eb62305a15e3989ad5a519cfb47378a06",
  "generatedAtUtc": "2026-09-08T07:52:43.517Z",
  "selection": "Display examples 825, 591 and 820 selected for distinct detector directions and larger reconstruction separations. Illustrative selection, not representative performance statistics. Exact computed coordinates retained.",
  "protocol": {
    "requestedCaseCount": 1000,
    "canonicalCaseCount": 1000,
    "seed": 20260907,
    "randomAlgorithm": "mulberry32",
    "sampling": "uniform solid angle over the spherical cap theta=[0,113] deg; phi=[0,360) deg",
    "maximumThetaDeg": 113,
    "detectorZenithBinEdgesDeg": [
      0,
      15,
      30,
      45,
      60,
      75,
      90,
      100,
      113
    ],
    "spectrum": {
      "normalization": 0.026,
      "spectralIndex": -1.07,
      "peakEnergyKeV": 756.4
    },
    "signalModel": "source-only deterministic expected response",
    "excluded": [
      "background",
      "Poisson sampling",
      "light curve",
      "duration",
      "occultation"
    ],
    "percentileDefinition": "Hyndman-Fan type 7 empirical percentile; descriptive, not a confidence interval"
  },
  "cases": [
    {
      "caseIndex": 825,
      "requestedDirection": {
        "thetaDeg": 51.20866137159635,
        "phiDeg": 311.8072459101677
      },
      "generation": {
        "status": "available",
        "runtimeMs": 2.6309170000022277,
        "selectedDatabaseDirections": [
          {
            "direction": {
              "sourceId": "source-320",
              "thetaDeg": 53.4375,
              "phiDeg": 311.1860046386719,
              "responseKey": "53_311"
            },
            "separationDeg": 2.2824106585329886,
            "weight": 0.47526066840652353
          },
          {
            "direction": {
              "sourceId": "source-262",
              "thetaDeg": 47.8125,
              "phiDeg": 313.3330078125,
              "responseKey": "47_313"
            },
            "separationDeg": 3.58874727040855,
            "weight": 0.30226146714117114
          },
          {
            "direction": {
              "sourceId": "source-321",
              "thetaDeg": 53.4375,
              "phiDeg": 317.2879943847656,
              "responseKey": "53_317"
            },
            "separationDeg": 4.8757210872325105,
            "weight": 0.2224778644523054
          }
        ],
        "nearestTemplateDistanceDeg": 2.2824106585329886,
        "containmentWarning": "outside-neighbour-triangle",
        "totalPixelCountsPerSecond": 3504.2168561521894
      },
      "methods": {
        "positive-excess-centroid": {
          "status": "available",
          "thetaDeg": 36.94825116830072,
          "phiDeg": 313.2815881086932,
          "requestedToReconstructedDeg": 14.296442127058025,
          "thetaResidualDeg": -14.260410203295628,
          "wrappedPhiResidualDeg": 1.4743421985255054,
          "runtimeMs": 0.052958999993279576
        },
        "ks-5deg-v2": {
          "status": "available",
          "thetaDeg": 53.375769120401934,
          "phiDeg": -42.75168826583856,
          "requestedToReconstructedDeg": 4.818190596615571,
          "thetaResidualDeg": 2.1671077488055843,
          "wrappedPhiResidualDeg": 5.4410658239937675,
          "maximumProbability": 0.06913227587938309,
          "selectedTemplateCount": 2,
          "runtimeMs": 83.22487500007264
        },
        "ks-2deg-v2": {
          "status": "available",
          "thetaDeg": 52.43909687048811,
          "phiDeg": -45.54297429105579,
          "requestedToReconstructedDeg": 2.419135377611818,
          "thetaResidualDeg": 1.230435498891758,
          "wrappedPhiResidualDeg": 2.6497797987765352,
          "maximumProbability": 0.3177446126937866,
          "selectedTemplateCount": 12,
          "runtimeMs": 531.8469159998931
        }
      }
    },
    {
      "caseIndex": 591,
      "requestedDirection": {
        "thetaDeg": 69.7296389655595,
        "phiDeg": 232.3050828371197
      },
      "generation": {
        "status": "available",
        "runtimeMs": 2.8884580000303686,
        "selectedDatabaseDirections": [
          {
            "direction": {
              "sourceId": "source-502",
              "thetaDeg": 70.3125,
              "phiDeg": 234.7830047607422,
              "responseKey": "70_234"
            },
            "separationDeg": 2.4005948921795497,
            "weight": 0.4255605986666165
          },
          {
            "direction": {
              "sourceId": "source-501",
              "thetaDeg": 70.3125,
              "phiDeg": 229.56500244140625,
              "responseKey": "70_229"
            },
            "separationDeg": 2.6402727374340724,
            "weight": 0.3869291929532943
          },
          {
            "direction": {
              "sourceId": "source-434",
              "thetaDeg": 64.6875,
              "phiDeg": 234.5449981689453,
              "responseKey": "64_234"
            },
            "separationDeg": 5.448229236677813,
            "weight": 0.18751020838008917
          }
        ],
        "nearestTemplateDistanceDeg": 2.4005948921795497,
        "containmentWarning": null,
        "totalPixelCountsPerSecond": 2975.6418523014904
      },
      "methods": {
        "positive-excess-centroid": {
          "status": "available",
          "thetaDeg": 45.1489803137696,
          "phiDeg": 232.9846570695663,
          "requestedToReconstructedDeg": 24.58710097441494,
          "thetaResidualDeg": -24.580658651789904,
          "wrappedPhiResidualDeg": 0.6795742324466119,
          "runtimeMs": 0.040625000023283064
        },
        "ks-5deg-v2": {
          "status": "available",
          "thetaDeg": 64.9652717694348,
          "phiDeg": -125.59217473913387,
          "requestedToReconstructedDeg": 5.144073253842567,
          "thetaResidualDeg": -4.764367196124695,
          "wrappedPhiResidualDeg": 2.102742423746463,
          "maximumProbability": 0.04327453300356865,
          "selectedTemplateCount": 3,
          "runtimeMs": 84.33554200001527
        },
        "ks-2deg-v2": {
          "status": "available",
          "thetaDeg": 69.0968805602183,
          "phiDeg": -127.16462452280575,
          "requestedToReconstructedDeg": 0.8042517144453017,
          "thetaResidualDeg": -0.6327584053412068,
          "wrappedPhiResidualDeg": 0.5302926400745491,
          "maximumProbability": 0.9988629817962646,
          "selectedTemplateCount": 11,
          "runtimeMs": 543.3033750000177
        }
      }
    },
    {
      "caseIndex": 820,
      "requestedDirection": {
        "thetaDeg": 101.12416338296153,
        "phiDeg": 100.42580092325807
      },
      "generation": {
        "status": "available",
        "runtimeMs": 2.4261249999981374,
        "selectedDatabaseDirections": [
          {
            "direction": {
              "sourceId": "source-835",
              "thetaDeg": 98.4375,
              "phiDeg": 100,
              "responseKey": "98_100"
            },
            "separationDeg": 2.719227656144088,
            "weight": 0.41177678958159986
          },
          {
            "direction": {
              "sourceId": "source-907",
              "thetaDeg": 104.06300354003906,
              "phiDeg": 101.40799713134766,
              "responseKey": "104_101"
            },
            "separationDeg": 3.0911805235980645,
            "weight": 0.3622288720573291
          },
          {
            "direction": {
              "sourceId": "source-906",
              "thetaDeg": 104.06300354003906,
              "phiDeg": 96.33799743652344,
              "responseKey": "104_96"
            },
            "separationDeg": 4.954614538172824,
            "weight": 0.22599433836107105
          }
        ],
        "nearestTemplateDistanceDeg": 2.719227656144088,
        "containmentWarning": null,
        "totalPixelCountsPerSecond": 1988.2765261838076
      },
      "methods": {
        "positive-excess-centroid": {
          "status": "available",
          "thetaDeg": 53.2523477728509,
          "phiDeg": 99.210948774715,
          "requestedToReconstructedDeg": 47.8854671142211,
          "thetaResidualDeg": -47.87181561011063,
          "wrappedPhiResidualDeg": -1.2148521485430592,
          "runtimeMs": 0.06883299991022795
        },
        "ks-5deg-v2": {
          "status": "available",
          "thetaDeg": 104.0676927761331,
          "phiDeg": 95.83972598293053,
          "requestedToReconstructedDeg": 5.356366916141479,
          "thetaResidualDeg": 2.9435293931715734,
          "wrappedPhiResidualDeg": -4.586074940327535,
          "maximumProbability": 0.08024240285158157,
          "selectedTemplateCount": 2,
          "runtimeMs": 81.29008299997076
        },
        "ks-2deg-v2": {
          "status": "available",
          "thetaDeg": 102.21450723634379,
          "phiDeg": 98.79527531781862,
          "requestedToReconstructedDeg": 1.9335471767332346,
          "thetaResidualDeg": 1.0903438533822651,
          "wrappedPhiResidualDeg": -1.6305256054394022,
          "maximumProbability": 0.3011772632598877,
          "selectedTemplateCount": 9,
          "runtimeMs": 533.1797919999808
        }
      }
    }
  ]
} as const;
