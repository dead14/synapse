import numpy as np

def dtw(s1, s2):
    n, m = len(s1), len(s2)
    D = np.full((n+1, m+1), np.inf)
    D[0,0] = 0


    for i in range(1, n+1):
        for j in range(1, m+1):
            cost = (s1[i-1] - s2[j-1])**2
            D[i,j] = cost + min(D[i-1,j], D[i,j-1], D[i-1,j-1])
    return np.sqrt(D[n, m]), D

jarak, matriks = dtw([1,2,3,4,5], [1,2,3,4,5])
print(jarak)

